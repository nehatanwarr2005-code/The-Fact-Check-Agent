import React from 'react';

export type ActiveScreen = 'landing' | 'processing' | 'dashboard' | 'report';

interface NavbarProps {
  screen: ActiveScreen;
  hasReport: boolean;
  historyCount: number;
  onNavigate: (target: ActiveScreen) => void;
  onScrollToSection: (sectionId: string) => void;
  onTriggerUploadFocus: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  screen,
  hasReport,
  historyCount,
  onNavigate,
  onScrollToSection,
  onTriggerUploadFocus,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Mark */}
        <button
          type="button"
          onClick={() => onNavigate('landing')}
          className="flex items-center gap-2.5 text-left text-[#0F1E3D] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-md"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="6" fill="#0F1E3D" />
            <path
              d="M7 12.5L10.3 15.8L17.2 8.5"
              stroke="#60A5FA"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-base font-bold tracking-tight">
            The Fact-Check Agent
          </span>
        </button>

        {/* Zone 2: Clean single-line text navigation */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          {hasReport ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('landing')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D] ${
                  screen === 'landing'
                    ? 'text-[#0F1E3D] font-semibold underline decoration-[#2563EB] decoration-2 underline-offset-8'
                    : ''
                }`}
              >
                New Audit
              </button>
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D] ${
                  screen === 'dashboard'
                    ? 'text-[#0F1E3D] font-semibold underline decoration-[#2563EB] decoration-2 underline-offset-8'
                    : ''
                }`}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => onNavigate('report')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D] ${
                  screen === 'report'
                    ? 'text-[#0F1E3D] font-semibold underline decoration-[#2563EB] decoration-2 underline-offset-8'
                    : ''
                }`}
              >
                Report Preview
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('landing');
                  setTimeout(() => onScrollToSection('recent-audits'), 60);
                }}
                className="py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D]"
              >
                History ({historyCount})
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onScrollToSection('upload-workspace')}
                className="py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D]"
              >
                Verify PDF
              </button>
              <button
                type="button"
                onClick={() => onScrollToSection('how-it-works')}
                className="py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D]"
              >
                How It Works
              </button>
              <button
                type="button"
                onClick={() => onScrollToSection('verification-standards')}
                className="py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D]"
              >
                Standards
              </button>
              <button
                type="button"
                onClick={() => onScrollToSection('recent-audits')}
                className="py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#0F1E3D]"
              >
                History ({historyCount})
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {screen === 'dashboard' && hasReport ? (
            <button
              type="button"
              onClick={() => onNavigate('report')}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
            >
              Export Report
            </button>
          ) : screen === 'report' && hasReport ? (
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
            >
              Back to Claims
            </button>
          ) : (
            <button
              type="button"
              onClick={onTriggerUploadFocus}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0F1E3D] hover:bg-[#172B54] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
            >
              Analyze PDF
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
