// Inspección del canvas realmente pintado: no accede a instancias, metadatos
// privados de Chart.js o hooks agregados al producto para las pruebas.
export async function chartPoints(page) {
  return page.locator('nexo-vehicle-speed-chart canvas').evaluate((canvas) => {
    if (!canvas.width || !canvas.height) return [];
    const context = canvas.getContext('2d');
    if (!context) return [];
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const visited = new Uint8Array(canvas.width * canvas.height);
    const blue = (index) =>
      data[index * 4] === 19 &&
      data[index * 4 + 1] === 118 &&
      data[index * 4 + 2] === 109 &&
      data[index * 4 + 3] === 255;
    const points = [];
    const bounds = canvas.getBoundingClientRect();
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || !blue(start)) continue;
      const pending = [start];
      let count = 0,
        x = 0,
        y = 0;
      while (pending.length) {
        const index = pending.pop();
        if (index < 0 || index >= visited.length || visited[index] || !blue(index)) continue;
        visited[index] = 1;
        count++;
        x += index % canvas.width;
        y += Math.floor(index / canvas.width);
        if (index % canvas.width) pending.push(index - 1);
        if (index % canvas.width < canvas.width - 1) pending.push(index + 1);
        pending.push(index - canvas.width, index + canvas.width);
      }
      if (count >= 5)
        points.push({
          x: ((x / count + 0.5) * bounds.width) / canvas.width,
          y: ((y / count + 0.5) * bounds.height) / canvas.height,
        });
    }
    return points.sort((first, second) => first.x - second.x || first.y - second.y);
  });
}

export async function chartColor(page, point) {
  return page.locator('nexo-vehicle-speed-chart canvas').evaluate((canvas, location) => {
    const bounds = canvas.getBoundingClientRect();
    return [
      ...canvas
        .getContext('2d')
        .getImageData(
          Math.floor((location.x * canvas.width) / bounds.width),
          Math.floor((location.y * canvas.height) / bounds.height),
          1,
          1,
        ).data,
    ];
  }, point);
}
