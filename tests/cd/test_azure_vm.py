import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('nexo_deploy', 'scripts/cd/azure-vm.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class SourceTests(unittest.TestCase):
    def test_digest_tracks_content_execution_and_symlink_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'file').write_text('source')
            first = deploy.source_digest(root)
            (root / 'file').write_text('changed')
            self.assertNotEqual(first, deploy.source_digest(root))
            (root / 'file').write_text('source')
            os.chmod(root / 'file', 0o755)
            self.assertNotEqual(first, deploy.source_digest(root))
            (root / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                deploy.source_digest(root)

    def test_archive_rejects_traversal_and_wrong_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            src = root / 'src'
            src.mkdir()
            (src / 'app').write_text('reviewed')
            expected = deploy.source_digest(src)
            archive = root / 'source.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(src, arcname='Nexo-sha')
            extracted = deploy.unpack_source(archive, root / 'good', expected)
            self.assertEqual(deploy.source_digest(extracted), expected)
            with self.assertRaises(ValueError):
                deploy.unpack_source(archive, root / 'wrong', '0' * 64)
            with tarfile.open(archive, 'w:gz') as tar:
                member = tarfile.TarInfo('../escape')
                member.size = 3
                tar.addfile(member, io.BytesIO(b'bad'))
            with self.assertRaises(ValueError):
                deploy.unpack_source(archive, root / 'unsafe', expected)

    def test_descriptor_rejects_partial_identity_and_unknown_images(self):
        value = {'release': 'a' * 40, 'sha': 'a' * 40, 'sourceDigest': 'b' * 64,
                 'images': {role: 'sha256:' + 'c' * 64 for role in deploy.ROLES}}
        self.assertEqual(deploy.validate_descriptor(value), value)
        for change in [{'release': '../outside'}, {'sha': None}, {'sourceDigest': None}, {'images': {'api': 'latest'}}]:
            with self.assertRaises(ValueError):
                deploy.validate_descriptor({**value, **change})


class ActivationTests(unittest.TestCase):
    def scenario(self, failure=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        private, releases = root / 'private', root / 'releases'
        private.mkdir()
        releases.mkdir()
        sha, old = 'a' * 40, 'b' * 40
        source = releases / sha
        source.mkdir()
        (source / 'source').write_text('reviewed')
        digest = deploy.source_digest(source)
        old_images = {role: 'sha256:' + 'c' * 64 for role in deploy.ROLES}
        new_images = {role: 'sha256:' + 'd' * 64 for role in deploy.ROLES}
        previous = {'release': old, 'sha': old, 'sourceDigest': 'e' * 64, 'images': old_images}
        (private / 'active-release.json').write_text(json.dumps(previous))
        (private / 'nginx.azure.conf').write_text('old proxy')
        events = []
        active = {'images': old_images}
        stop_failed = False

        def compose(release, *args, **kwargs):
            nonlocal stop_failed
            events.append((release, *args))
            if args[0] == 'stop' and failure == 'partial-stop' and not stop_failed:
                stop_failed = True
                raise RuntimeError('partially stopped')
            if args[0] == 'up':
                if release == sha and failure == 'activation':
                    raise RuntimeError('candidate failed')
                active['images'] = new_images if release == sha else old_images
            return ''

        def run(args, *unused, **kwargs):
            if '/source/scripts/prepare-cloud-proxy.mjs' in args:
                mount = next(arg for arg in args if arg.endswith(':/generated'))
                (Path(mount.removesuffix(':/generated')) / 'nginx.azure.conf').write_text('new proxy')
            return ''

        def scan(*args):
            if failure == 'scan':
                raise RuntimeError('security failed')

        with patch.object(deploy, 'PRIVATE', private), patch.object(deploy, 'RELEASES', releases):
            operator = deploy.Operator(io.StringIO())
            operator.target = lambda origin: origin
            operator.compose = compose
            operator.image = lambda reference: new_images['api']
            operator.current_images = lambda: active['images']
            operator.run = run
            operator.scan = scan
            operator.install_boot = lambda source: None
            operator.alias_source = lambda source: None
            operator.health = lambda origin: None
            operator.latest_main = lambda: 'f' * 40 if failure == 'superseded' else sha
            result = operator.deploy(sha, digest, 'https://nexo.example.com')
        return result, events, json.loads((private / 'active-release.json').read_text()), previous, (private / 'nginx.azure.conf').read_text()

    def test_failed_scan_never_stops_or_replaces_the_previous_release(self):
        result, events, active, previous, proxy = self.scenario('scan')
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(any(event[1] == 'stop' for event in events))
        self.assertEqual(active, previous)
        self.assertEqual(proxy, 'old proxy')

    def test_activation_failure_rolls_back_images_and_proxy(self):
        result, events, active, previous, proxy = self.scenario('activation')
        self.assertEqual(result['status'], 'rolled_back')
        self.assertEqual(active, previous)
        self.assertEqual(proxy, 'old proxy')
        self.assertEqual(events[-1][0], previous['release'])
        self.assertEqual(events[-1][1], 'up')

    def test_partial_stop_is_also_recovered(self):
        result, _, active, previous, _ = self.scenario('partial-stop')
        self.assertEqual(result['status'], 'rolled_back')
        self.assertEqual(active, previous)

    def test_health_confirmation_publishes_the_new_exact_release(self):
        result, _, active, _, proxy = self.scenario()
        self.assertEqual(result['status'], 'deployed')
        self.assertTrue(result['healthy'])
        self.assertEqual(active['sha'], 'a' * 40)
        self.assertEqual(active['images'], result['images'])
        self.assertEqual(proxy, 'new proxy')

    def test_main_changed_during_build_never_activates_the_old_candidate(self):
        result, events, active, previous, _ = self.scenario('superseded')
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(any(event[1] == 'stop' for event in events))
        self.assertEqual(active, previous)


if __name__ == '__main__':
    unittest.main()
