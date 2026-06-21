import { redirect } from 'next/navigation';

// Root /login → /admin/login alias. Both routes serve the same login form;
// keeping a root alias prevents 404s for clients that hit the canonical path.
export default function LoginAliasPage() {
  redirect('/admin/login');
}