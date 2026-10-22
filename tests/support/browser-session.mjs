export async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
