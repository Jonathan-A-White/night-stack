import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { BottomTabs } from './components/BottomTabs';
const EveningRoutineSettingsPage = lazy(() => import('./pages/settings/EveningRoutineSettingsPage'));
const RoutineTracker = lazy(() => import('./pages/tonight/RoutineTracker'));
import { TonightPlan } from './pages/tonight/TonightPlan';
import { EveningLog } from './pages/tonight/EveningLog';
import { EveningReview } from './pages/tonight/EveningReview';
import { MorningLog } from './pages/morning/MorningLog';
import { MorningReview } from './pages/morning/MorningReview';
import { Dashboard } from './pages/insights/Dashboard';
import { Correlations } from './pages/insights/Correlations';
import { BestNights } from './pages/insights/BestNights';
import { MetricDetail } from './pages/insights/MetricDetail';
import { CalendarPage } from './pages/calendar/CalendarPage';
import SettingsHome from './pages/settings/SettingsHome';
import AlarmSchedulePage from './pages/settings/AlarmSchedulePage';
import SupplementStackPage from './pages/settings/SupplementStackPage';
import ClothingItemsPage from './pages/settings/ClothingItemsPage';
import BeddingItemsPage from './pages/settings/BeddingItemsPage';
import MiddayCopingItemsPage from './pages/settings/MiddayCopingItemsPage';
import WakeUpCausesPage from './pages/settings/WakeUpCausesPage';
import BedtimeReasonsPage from './pages/settings/BedtimeReasonsPage';
import SleepRulesPage from './pages/settings/SleepRulesPage';
import LocationPage from './pages/settings/LocationPage';
import SleepEnvironmentPage from './pages/settings/SleepEnvironmentPage';
import DataManagementPage from './pages/settings/DataManagementPage';
import DataCleanupPage from './pages/settings/DataCleanupPage';
import AboutPage from './pages/settings/AboutPage';
import WeightProfilePage from './pages/settings/WeightProfilePage';
import { useTheme } from './hooks/useTheme';
import { InstallBanner } from './components/InstallBanner';

export function App() {
  useTheme();

  return (
    <div className="app-layout">
      <InstallBanner />
      <div className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/tonight" replace />} />
          <Route path="/tonight" element={<TonightPlan />} />
          <Route path="/tonight/log" element={<EveningLog />} />
          <Route path="/tonight/review/:id" element={<EveningReview />} />
          <Route path="/morning" element={<MorningLog />} />
          <Route path="/morning/review/:id" element={<MorningReview />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/insights" element={<Dashboard />} />
          <Route path="/insights/correlations" element={<Correlations />} />
          <Route path="/insights/best-nights" element={<BestNights />} />
          <Route path="/insights/metric/:type" element={<MetricDetail />} />
          <Route path="/settings" element={<SettingsHome />} />
          <Route path="/settings/evening-routine" element={<Suspense fallback={<div className="empty-state"><h3>Loading…</h3></div>}><EveningRoutineSettingsPage /></Suspense>} />
          <Route path="/tonight/routine" element={<Suspense fallback={<div className="empty-state"><h3>Loading…</h3></div>}><RoutineTracker /></Suspense>} />
          <Route path="/settings/alarm-schedule" element={<AlarmSchedulePage />} />
          <Route path="/settings/supplements" element={<SupplementStackPage />} />
          <Route path="/settings/clothing" element={<ClothingItemsPage />} />
          <Route path="/settings/bedding" element={<BeddingItemsPage />} />
          <Route path="/settings/midday-coping" element={<MiddayCopingItemsPage />} />
          <Route path="/settings/wake-up-causes" element={<WakeUpCausesPage />} />
          <Route path="/settings/bedtime-reasons" element={<BedtimeReasonsPage />} />
          <Route path="/settings/sleep-rules" element={<SleepRulesPage />} />
          <Route path="/settings/location" element={<LocationPage />} />
          <Route path="/settings/sleep-environment" element={<SleepEnvironmentPage />} />
          <Route path="/settings/weight-profile" element={<WeightProfilePage />} />
          <Route path="/settings/data" element={<DataManagementPage />} />
          <Route path="/settings/data/cleanup" element={<DataCleanupPage />} />
          <Route path="/settings/about" element={<AboutPage />} />
        </Routes>
      </div>
      <BottomTabs />
    </div>
  );
}
