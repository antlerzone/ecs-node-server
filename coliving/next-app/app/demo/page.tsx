import { redirect } from "next/navigation"

/** demo.colivingjb.com/demo — same flow as /demologin (mock portal). */
export default function DemoAliasPage() {
  redirect("/demologin")
}
