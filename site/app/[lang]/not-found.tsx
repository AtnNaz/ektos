import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap page-head" style={{ paddingBottom: '6rem' }}>
      <p className="kicker">404</p>
      <h1>This page does not exist</h1>
      <p className="lead"><Link href="/en">Back to the overview</Link></p>
    </div>
  );
}
