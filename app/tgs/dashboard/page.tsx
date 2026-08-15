import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "@/app/dashboard/DashboardClient";

export default async function TGSDashboardPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("tgs_session");
  if (!session) {
    redirect("/tgs/login");
  }
  const user = decodeURIComponent(session.value);
  return (
    <DashboardClient
      user={user}
      apiPrefix="/api/tgs"
      logoutPath="/api/auth/tgs/logout"
      loginPath="/tgs/login"
      partnerName="The Gift Studio"
    />
  );
}
