const CREDENTIALS: Record<string, string> = {
  "tgf@bouncetask.com": "tgf@bounce",
};

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email: string; password: string };

  if (CREDENTIALS[email] !== password) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const response = Response.json({ ok: true, user: email });
  response.headers.set(
    "Set-Cookie",
    `tgs_session=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`
  );
  return response;
}
