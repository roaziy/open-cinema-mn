import { redirect } from 'next/navigation';

/** The proxy sends signed-out visitors on to the right login page. */
export default function Home() {
  redirect('/admin');
}
