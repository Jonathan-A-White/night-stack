import { Navigate } from 'react-router-dom';
import { homePathFor, readLastApp } from '../apps';

/** `/` → the remembered app's home (Tracking on a fresh install). */
export function AppEntryRedirect() {
  return <Navigate to={homePathFor(readLastApp())} replace />;
}
