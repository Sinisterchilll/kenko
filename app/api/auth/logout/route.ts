export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    "kenko_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return response;
}
