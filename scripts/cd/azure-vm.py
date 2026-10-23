"""Deployment operator. Manifest mode runs without root or Docker."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import traceback
import urllib.request
import uuid

PRIVATE = Path('/opt/nexo-private')
RELEASES = Path('/opt/nexo-releases')
ROLES = ('api', 'web', 'db', 'gateway')
SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}')
ORIGIN = re.compile(r'https://[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?')


def source_digest(root, paths=None):
    root = Path(root).resolve()
    entries = []
    if paths is None:
        paths = [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()]
    for name in sorted(paths):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or '.git' in relative.parts:
            raise ValueError('Invalid source path')
        path = root / relative
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(path)
            if not (path.parent / target).resolve().is_relative_to(root):
                raise ValueError('Escaping source symlink')
            mode, data = '120000', os.fsencode(target)
        elif stat.S_ISREG(info.st_mode):
            mode = '100755' if info.st_mode & stat.S_IXUSR else '100644'
            data = path.read_bytes()
        else:
            raise ValueError('Invalid source entry')
        entries.append([relative.as_posix(), mode, hashlib.sha256(data).hexdigest()])
    return hashlib.sha256(json.dumps(entries, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def unpack_source(archive, directory, expected):
    if not DIGEST.fullmatch(expected):
        raise ValueError('Invalid digest')
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if not members or len(members) > 20000 or sum(m.size for m in members) > 128 * 1024 * 1024:
            raise ValueError('Invalid source archive')
        roots = set()
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or '..' in path.parts or member.isdev() or member.isfifo() or member.islnk():
                raise ValueError('Unsafe archive entry')
            roots.add(path.parts[0])
        if len(roots) != 1:
            raise ValueError('Ambiguous source archive')
        tar.extractall(directory, filter='data')
    root = Path(directory) / roots.pop()
    if source_digest(root) != expected:
        raise ValueError('Source differs from verified checkout')
    return root


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex)
    with temporary.open('x', encoding='utf8') as file:
        os.chmod(temporary, 0o600)
        json.dump(value, file, separators=(',', ':'))
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def validate_descriptor(value):
    if set(value) != {'release', 'sha', 'sourceDigest', 'images'}:
        raise ValueError('Invalid active release')
    release = value['release']
    if not re.fullmatch(r'[a-f0-9]{40}|bootstrap-[a-f0-9]{12}', release):
        raise ValueError('Invalid release identity')
    if release.startswith('bootstrap-'):
        if value['sha'] is not None or value['sourceDigest'] is not None:
            raise ValueError('Invalid bootstrap identity')
    elif value['sha'] != release or not isinstance(value['sourceDigest'], str) or not DIGEST.fullmatch(value['sourceDigest']):
        raise ValueError('Invalid release provenance')
    if set(value['images']) != set(ROLES) or not all(IMAGE.fullmatch(v) for v in value['images'].values()):
        raise ValueError('Invalid image inventory')
    return value


class Operator:
    def __init__(self, log, budget=1800):
        self.log = log
        self.deadline = time.monotonic() + budget
        self.phase = 'preflight'

    def run(self, args, capture=False, timeout=600):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Deployment budget exhausted')
        result = subprocess.run(args, stdout=subprocess.PIPE if capture else self.log,
                                stderr=self.log, timeout=min(timeout, remaining), check=True)
        if capture:
            if len(result.stdout) > 1024 * 1024:
                raise ValueError('Unexpected command output')
            return result.stdout.decode().strip()
        return ''

    def image(self, reference):
        image = self.run(['docker', 'image', 'inspect', reference, '--format', '{{.Id}}'], True)
        if not IMAGE.fullmatch(image):
            raise ValueError('Image not identified')
        return image

    def download(self, url, path):
        total = 0
        with urllib.request.urlopen(url, timeout=60) as response, Path(path).open('wb') as file:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 128 * 1024 * 1024 or time.monotonic() >= self.deadline:
                    raise TimeoutError('Download exceeds deployment limit')
                file.write(chunk)

    def latest_main(self):
        request = urllib.request.Request('https://api.github.com/repos/ngarayc/Nexo/git/ref/heads/main',
                                         headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'nexo-cd'})
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read(65536))['object']['sha']
        if not SHA.fullmatch(value):
            raise ValueError('Main not identified')
        return value

    def target(self, origin=None):
        path = PRIVATE / '.env.azure'
        info = path.stat()
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or path.is_symlink():
            raise ValueError('Private environment required')
        env = {}
        for line in path.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator:
                env[key.strip()] = value.strip().strip('\"\'')
        selected = env.get('PUBLIC_ORIGIN', '')
        if not ORIGIN.fullmatch(selected) or (origin is not None and origin != selected):
            raise ValueError('Origin differs')
        if env.get('DB_NAME') != 'nexo' or env.get('NEXO_DATA_PATH') != '/var/lib/nexo-data':
            raise ValueError('Database target differs')
        if env.get('NEXO_PROXY_CONFIG') != '/opt/nexo-private/nginx.azure.conf':
            raise ValueError('Proxy target differs')
        if not os.path.ismount('/var/lib/nexo-data'):
            raise ValueError('Persistent disk not mounted')
        options = json.loads(self.run(['docker', 'volume', 'inspect', 'nexo-cloud_postgres18-data',
                                     '--format', '{{json .Options}}'], True))
        if options != {'type': 'none', 'o': 'bind', 'device': '/var/lib/nexo-data/postgres'}:
            raise ValueError('Volume target differs')
        return selected

    def override(self, release, digest=None):
        path = PRIVATE / 'releases' / (release + '.compose.json')
        services = {}
        for role in ROLES:
            entry = {'image': f'nexo-{role}:release-{release}'}
            if digest is not None:
                entry['labels'] = {'io.github.ngarayc.nexo.release': release,
                                   'io.github.ngarayc.nexo.source-digest': digest}
                entry['build'] = {'labels': {'org.opencontainers.image.revision': release}}
            services[role] = entry
        atomic_json(path, {'services': services})
        return path

    def compose(self, release, *args, capture=False):
        source = RELEASES / release
        return self.run(['docker', 'compose', '--project-name', 'nexo-cloud', '--env-file',
                         str(PRIVATE / '.env.azure'), '-f', str(source / 'infra/compose.yaml'),
                         '-f', str(source / 'infra/compose.azure.yaml'), '-f',
                         str(PRIVATE / 'releases' / (release + '.compose.json')), *args],
                        capture, timeout=1200)

    def current_images(self):
        result = {}
        for role in ROLES:
            value = self.run(['docker', 'inspect', f'nexo-cloud-{role}-1', '--format',
                              '{{.Image}} {{index .Config.Labels "com.docker.compose.project"}}'], True)
            image, project = value.split(' ')
            if project != 'nexo-cloud' or not IMAGE.fullmatch(image):
                raise ValueError('Container identity differs')
            result[role] = image
        return result

    def health(self, origin):
        body = self.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15',
                         '--retry', '2', '--retry-delay', '2', origin + '/api/health'], True, 60)
        data = json.loads(body)
        if data != {'status': 'ok', 'database': 'ok', 'schema': 'ok'}:
            raise ValueError('Application not healthy')
        self.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15',
                  '--output', '/dev/null', origin + '/'], timeout=30)

    def active(self):
        return validate_descriptor(json.loads((PRIVATE / 'active-release.json').read_text()))

    def bootstrap(self, origin):
        if (PRIVATE / 'active-release.json').exists():
            return self.active()
        self.health(origin)
        release = 'bootstrap-' + uuid.uuid4().hex[:12]
        source = Path('/opt/nexo')
        if not source.is_dir() or (source / '.git').exists() or any(p.name != '.env.example' for p in source.rglob('.env*')):
            raise ValueError('Legacy source not identified')
        source_digest(source)  # Reject legacy links escaping the public source.
        shutil.copytree(source, RELEASES / release, symlinks=True)
        images = self.current_images()
        for role, image in images.items():
            self.run(['docker', 'tag', image, f'nexo-{role}:release-{release}'])
        self.override(release)
        descriptor = {'release': release, 'sha': None, 'sourceDigest': None, 'images': images}
        atomic_json(PRIVATE / 'active-release.json', descriptor)
        return descriptor

    def boot(self, mode):
        origin = self.target()
        descriptor = self.active()
        if descriptor['sourceDigest'] is not None and source_digest(RELEASES / descriptor['release']) != descriptor['sourceDigest']:
            raise ValueError('Active source changed')
        for role, image in descriptor['images'].items():
            if self.image(f'nexo-{role}:release-{descriptor["release"]}') != image:
                raise ValueError('Active image changed')
        if mode == 'up':
            self.compose(descriptor['release'], 'up', '-d', '--no-build', '--pull', 'never', '--wait')
            self.health(origin)
        elif mode == 'stop':
            self.compose(descriptor['release'], 'stop')
        elif mode == 'status':
            self.compose(descriptor['release'], 'ps')
            print(json.dumps({'sha': descriptor['sha'], 'release': descriptor['release'],
                              'images': descriptor['images']}, separators=(',', ':')))
        else:
            raise ValueError('Unknown boot operation')

    def install_boot(self, source):
        operator = Path('/usr/local/lib/nexo-deploy.py')
        shutil.copyfile(source / 'scripts/cd/azure-vm.py', operator)
        operator.chmod(0o755)
        shutil.copyfile(source / 'infra/nexo-compose.service', '/etc/systemd/system/nexo-compose.service')
        self.run(['systemctl', 'daemon-reload'])
        self.run(['systemctl', 'enable', 'nexo-compose.service'])

    def scan(self, source, operation, images):
        spec = json.loads((source / 'scripts/ci/tools.json').read_text())['trivy']
        archive = operation / 'trivy.tar.gz'
        self.download(spec['url'], archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
            raise ValueError('Scanner checksum differs')
        scanner = operation / 'trivy'
        with tarfile.open(archive) as tar:
            scanner.write_bytes(tar.extractfile('trivy').read())
        scanner.chmod(0o700)
        statuses = {}
        for role in ROLES:
            self.phase = 'scan-' + role
            with (operation / (role + '.scanner.log')).open('wb') as log:
                result = subprocess.run([str(scanner), 'image', '--cache-dir', str(operation / 'cache'),
                                         '--image-src', 'docker', '--scanners', 'vuln', '--severity',
                                         'HIGH,CRITICAL', '--exit-code', '1', '--format', 'json',
                                         '--output', str(operation / (role + '.json')),
                                         f'nexo-{role}:release-{images["release"]}'], stdout=log,
                                        stderr=log, timeout=min(300, self.deadline - time.monotonic()))
            statuses[role] = {'status': result.returncode, 'id': images['images'][role]}
        atomic_json(operation / 'scan-status.json', statuses)
        self.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                  '--security-opt', 'no-new-privileges:true', '--user', '0:0', '--entrypoint', 'node',
                  '-v', str(source) + ':/source:ro', '-v', str(operation) + ':/proof:ro',
                  f'nexo-api:release-{images["release"]}', '/source/scripts/cd/validate-images.mjs'], timeout=30)

    def deploy(self, sha, digest, origin):
        if not SHA.fullmatch(sha) or not DIGEST.fullmatch(digest) or not ORIGIN.fullmatch(origin):
            raise ValueError('Invalid deployment input')
        self.target(origin)
        RELEASES.mkdir(mode=0o755, exist_ok=True)
        RELEASES.chmod(0o755)
        operation = PRIVATE / 'deployments' / (sha + '-' + uuid.uuid4().hex[:12])
        operation.mkdir(parents=True, mode=0o700)
        previous = None
        activated = False
        try:
            if (PRIVATE / 'active-release.json').exists():
                current = self.active()
                if current['sha'] == sha and current['sourceDigest'] == digest and self.current_images() == current['images']:
                    self.health(origin)
                    return {'nexoDeployment': 1, 'status': 'already_current', 'sha': sha,
                            'healthy': True, 'images': current['images']}
            self.phase = 'download-source'
            source = RELEASES / sha
            if source.exists():
                if source_digest(source) != digest:
                    raise ValueError('Existing source changed')
            else:
                archive = operation / 'source.tar.gz'
                self.download(f'https://codeload.github.com/ngarayc/Nexo/tar.gz/{sha}', archive)
                unpacked = unpack_source(archive, operation / 'source', digest)
                os.rename(unpacked, source)
            self.override(sha, digest)
            self.compose(sha, 'config', '--quiet')
            for role in ROLES:
                self.phase = 'build-' + role
                self.compose(sha, 'build', role)
            images = {role: self.image(f'nexo-{role}:release-{sha}') for role in ROLES}
            descriptor = {'release': sha, 'sha': sha, 'sourceDigest': digest, 'images': images}
            self.scan(source, operation, descriptor)
            self.phase = 'confirm-current-main'
            if self.latest_main() != sha:
                raise ValueError('Main changed during build; candidate not activated')
            previous = self.bootstrap(origin)
            atomic_json(operation / 'previous.json', previous)
            self.install_boot(source)
            self.phase = 'activate'
            activated = True
            self.compose(previous['release'], 'stop')
            # El archivo del proxy se conserva: su contenido se comprueba contra
            # la plantilla del candidato antes de sustituirlo.
            self.run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node',
                      '--user', '0:0', '-w', '/source', '-v', str(source) + ':/source:ro',
                      '-v', str(operation) + ':/generated', f'nexo-api:release-{sha}',
                      '/source/scripts/prepare-cloud-proxy.mjs', '/generated'])
            old_proxy = (PRIVATE / 'nginx.azure.conf').read_bytes()
            (operation / 'previous-proxy.conf').write_bytes(old_proxy)
            shutil.copyfile(operation / 'nginx.azure.conf', PRIVATE / 'nginx.azure.conf')
            os.chmod(PRIVATE / 'nginx.azure.conf', 0o644)
            self.compose(sha, 'up', '-d', '--no-build', '--pull', 'never', '--wait')
            self.phase = 'verify-health'
            if self.current_images() != images:
                raise ValueError('Running images differ')
            self.health(origin)
            for role, image in images.items():
                self.run(['docker', 'tag', image, f'nexo-{role}:local'])
            atomic_json(PRIVATE / 'active-release.json', descriptor)
            atomic_json(PRIVATE / 'previous-release.json', previous)
            self.alias_source(source)
            atomic_json(operation / 'release.json', descriptor)
            return {'nexoDeployment': 1, 'status': 'deployed', 'sha': sha, 'healthy': True, 'images': images}
        except Exception:
            traceback.print_exc(file=self.log)
            result = {'nexoDeployment': 1, 'status': 'failed', 'sha': sha, 'healthy': False, 'phase': self.phase}
            if activated and previous is not None:
                try:
                    self.deadline = time.monotonic() + 300
                    self.compose(sha, 'stop')
                    proxy = operation / 'previous-proxy.conf'
                    if proxy.exists():
                        shutil.copyfile(proxy, PRIVATE / 'nginx.azure.conf')
                    self.compose(previous['release'], 'up', '-d', '--no-build', '--pull', 'never', '--wait')
                    self.health(origin)
                    if self.current_images() != previous['images']:
                        raise ValueError('Rollback images differ')
                    for role, image in previous['images'].items():
                        self.run(['docker', 'tag', image, f'nexo-{role}:local'])
                    atomic_json(PRIVATE / 'active-release.json', previous)
                    self.alias_source(RELEASES / previous['release'])
                    result['status'] = 'rolled_back'
                    result['healthy'] = True
                except Exception:
                    traceback.print_exc(file=self.log)
                    result['status'] = 'rollback_failed'
            return result

    def alias_source(self, source):
        alias = Path('/opt/nexo')
        if alias.exists() and not alias.is_symlink():
            os.rename(alias, RELEASES / ('original-' + uuid.uuid4().hex[:12]))
        temporary = Path('/opt/nexo-link-' + uuid.uuid4().hex[:12])
        temporary.symlink_to(source)
        os.replace(temporary, alias)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'manifest':
        root = Path(sys.argv[2]).resolve()
        paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
        print(source_digest(root, [p for p in paths if p]))
        return
    if os.geteuid() != 0:
        raise PermissionError('Root required for VM operations')
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    os.umask(0o077)
    with (PRIVATE / 'deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with (PRIVATE / 'deployment-private.log').open('a') as log:
            operator = Operator(log)
            if len(sys.argv) == 3 and sys.argv[1] == 'boot':
                operator.boot(sys.argv[2])
            elif len(sys.argv) == 5 and sys.argv[1] == 'deploy':
                result = operator.deploy(*sys.argv[2:])
                print(json.dumps(result, separators=(',', ':')))
                if result['status'] not in ('deployed', 'already_current'):
                    sys.exit(1)
            else:
                raise ValueError('Unknown operation')


if __name__ == '__main__':
    main()
