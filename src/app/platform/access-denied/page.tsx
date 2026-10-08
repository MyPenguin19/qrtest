import Link from "next/link";
export default function PlatformDeniedPage() {
  return <main className="mx-auto max-w-md space-y-4 p-6"><h1 className="text-2xl font-semibold">Platform access unavailable</h1><p>Your account could not be authorized. Platform access requires separate operator provisioning and verified MFA. If this is unexpected, contact the platform operator or try again.</p><p><Link href="/platform/login">Sign in</Link> · <Link href="/platform/mfa">Set up or verify MFA</Link> · <Link href="/platform">Retry</Link></p></main>;
}
