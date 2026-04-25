const DEMO_EMAIL = "demo@kenko.com";
const DEMO_PASSWORD = "kenko2024";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email: string; password: string };

  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const response = Response.json({ ok: true, user: email });
  response.headers.set(
    "Set-Cookie",
    `kenko_session=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`
  );
  return response;
}
