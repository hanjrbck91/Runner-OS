import { redirect } from 'next/navigation';

// Root entry -> Today (auth is enforced by the (app) layout).
export default function RootIndex() {
  redirect('/today');
}
