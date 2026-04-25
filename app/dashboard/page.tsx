import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("kenko_session");
  if (!session) {
    redirect("/login");
  }
  const user = decodeURIComponent(session.value);
  return <DashboardClient user={user} />;
}
