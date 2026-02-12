interface MainNavProps {
  currentPage: 'home' | 'calendar';
  onNavigate: (page: 'home' | 'calendar') => void;
}

export function MainNav({ currentPage, onNavigate }: MainNavProps) {
  return (
    <nav className="main-nav">
      <button
        className={`nav-btn ${currentPage === 'home' ? 'active' : ''}`}
        onClick={() => onNavigate('home')}
      >
        数据面板
      </button>
      <button
        className={`nav-btn ${currentPage === 'calendar' ? 'active' : ''}`}
        onClick={() => onNavigate('calendar')}
      >
        训练日历
      </button>
    </nav>
  );
}
