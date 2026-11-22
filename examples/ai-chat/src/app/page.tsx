import { redirect } from 'next/navigation';
import { id } from '@sidekickdb/admin';

export default function Home() {
  redirect(`/chat/${id()}`);
}
