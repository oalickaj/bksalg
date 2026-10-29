import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <>
      <p className="eyebrow">Admin</p>
      <h1>Logg inn</h1>
      <LoginForm />
    </>
  );
}
