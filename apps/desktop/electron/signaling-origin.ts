import http from 'node:http';

async function isSignalingService(origin: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = http.get(`${origin}/health`, { timeout: 1500 }, response => {
      let body = '';
      response.on('data', chunk => {
        body += String(chunk);
        if (body.length > 8192) { response.destroy(); resolve(false); }
      });
      response.on('error', () => resolve(false));
      response.on('end', () => {
        try { const health = JSON.parse(body); resolve(response.statusCode === 200 && health.ok === true && health.service === 'game-share-signaling'); }
        catch { resolve(false); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

/** localhost can resolve to a different process on IPv4 and IPv6. Verify the service. */
export async function resolveSignalingOrigin(port: number): Promise<string> {
  for (const origin of [`http://[::1]:${port}`, `http://127.0.0.1:${port}`]) {
    if (await isSignalingService(origin)) return origin;
  }
  throw new Error(`本机端口 ${port} 未找到有效的 GameShare 信令服务。请检查服务是否启动，或端口是否被其他程序占用。`);
}
