import { Routes, Route, Navigate } from 'react-router-dom';
import { BottomTabs } from './components/BottomTabs';
import { TonightPlan } from './pages/tonight/TonightPlan';
import { EveningLog } from './pages/tonight/EveningLog';
import { EveningReview } from './pages/tonight/EveningReview';
import { MorningLog } from './pages/morning/MorningLog';
import { MorningReview } from './pages/morning/MorningReview';
import { Dashboard } from './pages/insights/Dashboard';
import { Correlations } from './pages/insights/Correlations';
import { BestNights } from './pages/insights/BestNights';
import SettingsHome from './pages/settings/SettingsHome';
import AlarmSchedulePage from './pages/settings/AlarmSchedulePage';
import SupplementStackPage from './pages/settings/SupplementStackPage';
import ClothingItemsPage from './pages/settings/ClothingItemsPage';
import BeddingItemsPage from './pages/settings/BeddingItemsPage';
import WakeUpCausesPage from './pages/settings/WakeUpCausesPage';
import BedtimeReasonsPage from './pages/settings/BedtimeReasonsPage';
import SleepRulesPage from './pages/settings/SleepRulesPage';
import LocationPage from './pages/settings/LocationPage';
import DataManagementPage from './pages/settings/DataManagementPage';
import AboutPage from './pages/settings/AboutPage';
import { useTheme } from './hooks/useTheme';

export function App() {
  useTheme();

  return (
    <div className="app-layout">
      <div className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/tonight" replace />} />
          <Route path="/tonight" element={<TonightPlan />} />
          <Route path="/tonight/log" element={<EveningLog />} />
          <Route path="/tonight/review/:date" element={<EveningReview />} />
          <Route path="/morning" element={<MorningLog />} />
          <Route path="/morning/review/:date" element={<MorningReview />} />
          <Route path="/insights" element={<Dashboard />} />
          <Route path="/insights/correlations" element={<Correlations />} />
          <Route path="/insights/best-nights" element={<BestNights />} />
          <Route path="/settings" element={<SettingsHome />} />
          <Route path="/settings/alarm" element={<AlarmSchedulePage />} />
          <Route path="/settings/supplements" element={<SupplementStackPage />} />
          <Route path="/settings/clothing" element={<ClothingItemsPage />} />
          <Route path="/settings/bedding" element={<BeddingItemsPage />} />
          <Route path="/settings/wake-causes" element={<WakeUpCausesPage />} />
          <Route path="/settings/bedtime-reasons" element={<BedtimeReasonsPage />} />
          <Route path="/settings/rules" element={<SleepRulesPage />} />
          <Route path="/settings/location" element={<LocationPage />} />
          <Route path="/settings/data" element={<DataManagementPage />} />
          <Route path="/settings/about" element={<AboutPage />} />
        </Routes>
      </div>
      <BottomTabs />
    </div>
  );
}
