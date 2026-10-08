import { PlatformLogin } from "@/components/platform/platform-login";
export default function PlatformLoginPage() {
  return <main className="mx-auto max-w-md space-y-4 p-6"><h1 className="text-2xl font-semibold">Platform sign in</h1><p>Use your existing verified account. Separate platform authorization and MFA are required.</p><PlatformLogin /></main>;
}
