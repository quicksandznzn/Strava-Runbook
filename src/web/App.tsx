import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { HomePage } from './pages/HomePage.js';
import { CalendarPage } from './pages/CalendarPage.js';

export function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <nav className="main-nav card">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
            仪表盘
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            训练日历
          </NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
