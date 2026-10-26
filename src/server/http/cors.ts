export function applyMiniAppCors(response: Response) {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-headers", "authorization, content-type");
  response.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  return response;
}
