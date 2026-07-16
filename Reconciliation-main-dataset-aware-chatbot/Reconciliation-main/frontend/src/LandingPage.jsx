
import React, { useState, useEffect } from 'react';
import LoginPage from './LoginPage';

const LandingPage = () => {
  const [showLogin, setShowLogin] = useState(false);
  const [statsAnimated, setStatsAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setStatsAnimated(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    const statsSection = document.getElementById('stats-section');
    if (statsSection) observer.observe(statsSection);

    return () => {
      if (statsSection) observer.unobserve(statsSection);
    };
  }, []);

  const AnimatedCounter = ({ end, suffix = '' }) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
      if (!statsAnimated) return;
      
      let start = 0;
      const duration = 2000;
      const increment = end / (duration / 16);
      
      const timer = setInterval(() => {
        start += increment;
        if (start >= end) {
          setCount(end);
          clearInterval(timer);
        } else {
          setCount(Math.floor(start));
        }
      }, 16);

      return () => clearInterval(timer);
    }, [statsAnimated, end]);

    return (
      <span>{count}{suffix}</span>
    );
  };

  if (showLogin) {
    return <LoginPage />;
  }

  return (
    <div className="landing-page">
      {/* Navigation */}
      <nav className="landing-nav">
        <div className="nav-logo">
          <img src="/favicon.svg" alt="logo" />
          <span className="nav-brand">Reconciliation</span>
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#testimonials">Testimonials</a>
          <button className="nav-btn-secondary" onClick={() => setShowLogin(true)}>Sign In</button>
          <button className="nav-btn-primary" onClick={() => setShowLogin(true)}>Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-gradient-blob blob-1"></div>
        <div className="hero-gradient-blob blob-2"></div>
        <div className="hero-gradient-blob blob-3"></div>
        
        <div className="hero-content">
          <h1 className="hero-title">
            Transform Raw Data into
            <span className="hero-gradient-text"> Actionable Insights</span> with AI
          </h1>
          <p className="hero-subtitle">
            Automate Data Reconciliation, Perform Intelligent EDA, Visualize Time-Series Trends, and Detect Data Quality Issues in Seconds.
          </p>
          <div className="hero-buttons">
            <button className="hero-btn-primary" onClick={() => setShowLogin(true)}>Get Started</button>
            <button className="hero-btn-secondary">Watch Demo</button>
          </div>
        </div>

        {/* Dashboard Mockup */}
        <div className="hero-mockup">
          <div className="mockup-container">
            <div className="mockup-header">
              <div className="mockup-dots">
                <span className="dot red"></span>
                <span className="dot yellow"></span>
                <span className="dot green"></span>
              </div>
            </div>
            <div className="mockup-content">
              <div className="mockup-cards">
                <div className="mockup-card">
                  <div className="mockup-card-title">Match %</div>
                  <div className="mockup-card-value">98.5%</div>
                </div>
                <div className="mockup-card">
                  <div className="mockup-card-title">Missing Records</div>
                  <div className="mockup-card-value">12</div>
                </div>
                <div className="mockup-card">
                  <div className="mockup-card-title">Duplicates</div>
                  <div className="mockup-card-value">5</div>
                </div>
                <div className="mockup-card">
                  <div className="mockup-card-title">Insights</div>
                  <div className="mockup-card-value">23</div>
                </div>
              </div>
              <div className="mockup-charts">
                <div className="mockup-chart chart-line">
                  <svg viewBox="0 0 300 150">
                    <path d="M10,120 Q50,80 100,100 T190,60 T290,80" fill="none" stroke="#4F46E5" strokeWidth="3"/>
                    <path d="M10,120 Q50,80 100,100 T190,60 T290,80 V140 H10 Z" fill="url(#lineGradient)" opacity="0.3"/>
                    <defs>
                      <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.5"/>
                        <stop offset="100%" stopColor="#4F46E5" stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <div className="mockup-chart chart-pie">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#06B6D4" strokeWidth="20" strokeDasharray="125.6 251.2" transform="rotate(-90 50 50)"/>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#4F46E5" strokeWidth="20" strokeDasharray="80 251.2" strokeDashoffset="-125.6" transform="rotate(-90 50 50)"/>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#8B5CF6" strokeWidth="20" strokeDasharray="45.6 251.2" strokeDashoffset="-205.6" transform="rotate(-90 50 50)"/>
                  </svg>
                </div>
              </div>
              <div className="mockup-table">
                <div className="mockup-row">
                  <div className="mockup-cell">ID</div>
                  <div className="mockup-cell">Name</div>
                  <div className="mockup-cell">Status</div>
                </div>
                <div className="mockup-row">
                  <div className="mockup-cell">001</div>
                  <div className="mockup-cell">Alpha Corp</div>
                  <div className="mockup-cell badge-matched">Matched</div>
                </div>
                <div className="mockup-row">
                  <div className="mockup-cell">002</div>
                  <div className="mockup-cell">Beta Inc</div>
                  <div className="mockup-cell badge-updated">Updated</div>
                </div>
                <div className="mockup-row">
                  <div className="mockup-cell">003</div>
                  <div className="mockup-cell">Gamma Ltd</div>
                  <div className="mockup-cell badge-added">Added</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By Section */}
      <section className="trusted-section">
        <p className="trusted-text">Trusted by Data Analysts, Financial Teams, and Enterprises</p>
        <div className="trusted-logos">
          {['Company A', 'Company B', 'Company C', 'Company D', 'Company E'].map((company, i) => (
            <div key={i} className="trusted-logo">{company}</div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section" id="features">
        <div className="section-header">
          <h2 className="section-title">Powerful Features</h2>
          <p className="section-subtitle">Everything you need to master your data reconciliation workflow</p>
        </div>
        <div className="features-grid">
          {[
            { icon: '📂', title: 'Smart Dataset Upload', desc: 'Easily upload CSV and Excel files with drag-and-drop support' },
            { icon: '🤖', title: 'AI-powered Reconciliation', desc: 'Automatically reconcile source and target datasets with AI' },
            { icon: '📊', title: 'Exploratory Data Analysis', desc: 'Perform intelligent EDA with automated insights' },
            { icon: '📈', title: 'Time-Series Analytics', desc: 'Analyze trends and patterns over time with beautiful charts' },
            { icon: '📉', title: 'Interactive Visualizations', desc: 'Generate stunning charts and graphs in seconds' },
            { icon: '🔍', title: 'Duplicate & Missing Detection', desc: 'Automatically find duplicates and missing records' },
            { icon: '📄', title: 'Download Reports', desc: 'Export comprehensive reconciliation reports to Excel' },
            { icon: '💬', title: 'AI Dataset Assistant', desc: 'Chat with your data using our AI-powered assistant' },
          ].map((feature, i) => (
            <div key={i} className="feature-card">
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-desc">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow Section */}
      <section className="workflow-section" id="workflow">
        <div className="section-header">
          <h2 className="section-title">Simple Workflow</h2>
          <p className="section-subtitle">Seven easy steps to transform your data</p>
        </div>
        <div className="workflow-steps">
          {[
            'Upload Dataset',
            'AI Processes Data',
            'Perform EDA',
            'Reconcile Source & Target',
            'Generate Charts',
            'Analyze Time-Series Trends',
            'Export Reports',
          ].map((step, i) => (
            <React.Fragment key={i}>
              <div className="workflow-step">
                <div className="workstep-number">{i + 1}</div>
                <div className="workstep-text">{step}</div>
              </div>
              {i < 6 && <div className="workflow-arrow">↓</div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* Dashboard Preview */}
      <section className="dashboard-preview-section">
        <div className="section-header">
          <h2 className="section-title">Real Dashboard Preview</h2>
          <p className="section-subtitle">See what your data can reveal</p>
        </div>
        <div className="dashboard-preview">
          <div className="preview-card">
            <div className="preview-header">
              <div className="preview-title">Summary</div>
            </div>
            <div className="preview-stats">
              <div className="preview-stat">
                <div className="preview-stat-label">Match Percentage</div>
                <div className="preview-stat-value">98.5%</div>
              </div>
              <div className="preview-stat">
                <div className="preview-stat-label">Missing Records</div>
                <div className="preview-stat-value">12</div>
              </div>
              <div className="preview-stat">
                <div className="preview-stat-label">Duplicates</div>
                <div className="preview-stat-value">5</div>
              </div>
            </div>
            <div className="preview-chart">
              <svg viewBox="0 0 400 200">
                <rect x="50" y="150" width="40" height="40" fill="#4F46E5" rx="4"/>
                <rect x="110" y="120" width="40" height="70" fill="#06B6D4" rx="4"/>
                <rect x="170" y="90" width="40" height="100" fill="#8B5CF6" rx="4"/>
                <rect x="230" y="110" width="40" height="80" fill="#4F46E5" rx="4"/>
                <rect x="290" y="70" width="40" height="120" fill="#06B6D4" rx="4"/>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="why-choose-section">
        <div className="section-header">
          <h2 className="section-title">Why Choose Us</h2>
          <p className="section-subtitle">The benefits that set us apart</p>
        </div>
        <div className="why-grid">
          {[
            { icon: '⚡', title: 'Faster Analysis', desc: 'Get insights in seconds, not hours' },
            { icon: '🎯', title: 'Accurate Reconciliation', desc: 'Precision matching with AI-powered algorithms' },
            { icon: '📊', title: 'Intelligent Visualizations', desc: 'Beautiful charts that tell your data story' },
            { icon: '🤖', title: 'AI Insights', desc: 'Automated analysis powered by advanced AI' },
            { icon: '📈', title: 'Time-Series Monitoring', desc: 'Track changes over time effortlessly' },
            { icon: '🔒', title: 'Secure Processing', desc: 'Your data is protected with enterprise-grade security' },
            { icon: '⚙️', title: 'Automated Workflow', desc: 'Streamline your processes with automation' },
          ].map((item, i) => (
            <div key={i} className="why-card">
              <div className="why-icon">{item.icon}</div>
              <h3 className="why-title">{item.title}</h3>
              <p className="why-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Statistics Section */}
      <section className="stats-section" id="stats-section">
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter end={10} suffix="M+" /></div>
            <div className="stat-label">Records Processed</div>
          </div>
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter end={99.9} suffix="%" /></div>
            <div className="stat-label">Accuracy</div>
          </div>
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter end={80} suffix="%" /></div>
            <div className="stat-label">Reduction in Manual Work</div>
          </div>
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter end={5} suffix="x" /></div>
            <div className="stat-label">Faster Analysis</div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="testimonials-section" id="testimonials">
        <div className="section-header">
          <h2 className="section-title">What Our Users Say</h2>
          <p className="section-subtitle">Real feedback from data professionals</p>
        </div>
        <div className="testimonials-grid">
          {[
            { name: 'Sarah Johnson', role: 'Data Analyst', text: 'This platform saved us hundreds of hours of manual reconciliation. The AI features are incredible!' },
            { name: 'Michael Chen', role: 'Financial Controller', text: 'The accuracy and speed are unmatched. Our month-end close process is now 80% faster.' },
            { name: 'Emily Rodriguez', role: 'Business Intelligence Lead', text: 'The visualizations and insights help us make better decisions faster than ever before.' },
          ].map((testimonial, i) => (
            <div key={i} className="testimonial-card">
              <p className="testimonial-text">"{testimonial.text}"</p>
              <div className="testimonial-author">
                <div className="author-avatar">{testimonial.name.charAt(0)}</div>
                <div>
                  <div className="author-name">{testimonial.name}</div>
                  <div className="author-role">{testimonial.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="cta-section">
        <div className="cta-content">
          <h2 className="cta-title">Ready to Automate Your Data Analysis?</h2>
          <p className="cta-subtitle">Join thousands of data professionals transforming their workflows</p>
          <button className="cta-btn" onClick={() => setShowLogin(true)}>Start Free</button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <img src="/favicon.svg" alt="logo" />
            <span className="footer-name">Reconciliation</span>
            <p className="footer-tagline">Transforming data into insights</p>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#workflow">Workflow</a>
            </div>
            <div className="footer-column">
              <h4>Resources</h4>
              <a href="#">Documentation</a>
              <a href="#">Contact</a>
            </div>
            <div className="footer-column">
              <h4>Legal</h4>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2025 Reconciliation. All rights reserved.</p>
        </div>
      </footer>

      {/* Styles */}
      <style>{`
        .landing-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #0a0f25 0%, #0f172a 50%, #1a1f3a 100%);
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        }

        /* Navigation */
        .landing-nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          padding: 1.5rem 4rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(10, 15, 37, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .nav-logo img {
          height: 36px;
        }

        .nav-brand {
          font-size: 1.5rem;
          font-weight: 700;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 2rem;
        }

        .nav-links a {
          color: #94a3b8;
          text-decoration: none;
          font-weight: 500;
          transition: color 0.3s;
        }

        .nav-links a:hover {
          color: #fff;
        }

        .nav-btn-secondary {
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.2);
          background: transparent;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .nav-btn-secondary:hover {
          background: rgba(255,255,255,0.1);
        }

        .nav-btn-primary {
          position: relative;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.3s, box-shadow 0.3s;
        }

        .nav-btn-primary::after {
          content: '';
          position: absolute;
          top: 0; left: -60%;
          width: 40%; height: 100%;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.45), transparent);
          transform: skewX(-20deg);
          transition: left 0.6s ease;
        }

        .nav-btn-primary:hover::after { left: 130%; }

        .nav-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 40px rgba(79, 70, 229, 0.4);
        }

        /* Hero Section */
        .hero-section {
          position: relative;
          padding: 10rem 4rem 6rem;
          overflow: hidden;
        }

        .hero-gradient-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.5;
          animation: float 8s ease-in-out infinite;
        }

        .blob-1 {
          top: 10%;
          left: 10%;
          width: 400px;
          height: 400px;
          background: #4F46E5;
        }

        .blob-2 {
          top: 50%;
          right: 10%;
          width: 350px;
          height: 350px;
          background: #06B6D4;
          animation-delay: -3s;
        }

        .blob-3 {
          bottom: 10%;
          left: 40%;
          width: 300px;
          height: 300px;
          background: #8B5CF6;
          animation-delay: -6s;
        }

        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -30px) scale(1.1); }
        }

        .hero-content {
          position: relative;
          z-index: 1;
          text-align: center;
          max-width: 900px;
          margin: 0 auto 4rem;
          animation: heroFadeUp 0.9s cubic-bezier(.2,.8,.2,1) both;
        }

        @keyframes heroFadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .hero-mockup { animation: heroFadeUp 1s cubic-bezier(.2,.8,.2,1) 0.15s both; }

        .hero-title {
          font-size: 4rem;
          font-weight: 800;
          line-height: 1.1;
          margin-bottom: 1.5rem;
        }

        .hero-gradient-text {
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-subtitle {
          font-size: 1.25rem;
          color: #94a3b8;
          margin-bottom: 2.5rem;
          line-height: 1.6;
        }

        .hero-buttons {
          display: flex;
          justify-content: center;
          gap: 1rem;
        }

        .hero-btn-primary {
          position: relative;
          padding: 1rem 2.5rem;
          border-radius: 16px;
          border: none;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          color: #fff;
          font-size: 1.1rem;
          font-weight: 700;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.3s, box-shadow 0.3s;
        }

        .hero-btn-primary::after {
          content: '';
          position: absolute;
          top: 0; left: -60%;
          width: 40%; height: 100%;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-20deg);
          transition: left 0.6s ease;
        }

        .hero-btn-primary:hover::after { left: 130%; }

        .hero-btn-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 15px 50px rgba(79, 70, 229, 0.5);
        }

        .hero-btn-primary:active { transform: translateY(-1px) scale(0.98); }

        .hero-btn-secondary {
          padding: 1rem 2.5rem;
          border-radius: 16px;
          border: 2px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.03);
          backdrop-filter: blur(10px);
          color: #fff;
          font-size: 1.1rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s;
        }

        .hero-btn-secondary:hover {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.35);
          transform: translateY(-3px);
        }

        /* Mockup */
        .hero-mockup {
          position: relative;
          z-index: 1;
          max-width: 1200px;
          margin: 0 auto;
        }

        .mockup-container {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px;
          backdrop-filter: blur(20px);
          box-shadow: 0 50px 100px rgba(0,0,0,0.5);
          overflow: hidden;
        }

        .mockup-header {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
        }

        .mockup-dots {
          display: flex;
          gap: 8px;
        }

        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .dot.red { background: #ef4444; }
        .dot.yellow { background: #f59e0b; }
        .dot.green { background: #22c55e; }

        .mockup-content {
          padding: 2rem;
        }

        .mockup-cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .mockup-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 1.5rem;
          transition: transform 0.3s, border-color 0.3s, background 0.3s;
        }

        .mockup-card:hover {
          transform: translateY(-4px);
          border-color: rgba(6,182,212,0.4);
          background: rgba(255,255,255,0.08);
        }

        .mockup-card-title {
          color: #94a3b8;
          font-size: 0.875rem;
          margin-bottom: 0.5rem;
        }

        .mockup-card-value {
          font-size: 1.75rem;
          font-weight: 800;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .mockup-charts {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .mockup-chart {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 1.5rem;
        }

        .chart-line svg, .chart-pie svg {
          width: 100%;
          height: 100%;
        }

        .mockup-table {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          overflow: hidden;
        }

        .mockup-row {
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .mockup-row:last-child {
          border-bottom: none;
        }

        .mockup-cell {
          color: #cbd5e1;
        }

        .badge-matched {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-radius: 100px;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .badge-updated {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border-radius: 100px;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .badge-added {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
          border-radius: 100px;
          font-size: 0.875rem;
          font-weight: 600;
        }

        /* Section Headers */
        .section-header {
          text-align: center;
          max-width: 700px;
          margin: 0 auto 4rem;
        }

        .section-title {
          font-size: 3rem;
          font-weight: 800;
          margin-bottom: 1rem;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #ffffff 0%, #c7d2fe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .section-subtitle {
          font-size: 1.25rem;
          color: #94a3b8;
        }

        /* Trusted Section */
        .trusted-section {
          padding: 4rem;
          text-align: center;
        }

        .trusted-text {
          color: #94a3b8;
          font-size: 1rem;
          margin-bottom: 2rem;
        }

        .trusted-logos {
          display: flex;
          justify-content: center;
          gap: 3rem;
          flex-wrap: wrap;
        }

        .trusted-logo {
          color: #64748b;
          font-weight: 600;
          font-size: 1.25rem;
          padding: 1rem 2rem;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
          transition: transform 0.3s, color 0.3s, border-color 0.3s;
        }

        .trusted-logo:hover {
          transform: translateY(-3px);
          color: #cbd5e1;
          border-color: rgba(6,182,212,0.35);
        }

        /* Features Section */
        .features-section {
          padding: 6rem 4rem;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .feature-card {
          position: relative;
          background: rgba(255,255,255,0.035);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 2rem;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(.2,.8,.2,1), box-shadow 0.35s, border-color 0.35s, background 0.35s;
        }

        .feature-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(79,70,229,0.12), rgba(6,182,212,0.12));
          opacity: 0;
          transition: opacity 0.35s;
          pointer-events: none;
        }

        .feature-card:hover {
          transform: translateY(-8px) scale(1.015);
          border-color: rgba(79, 70, 229, 0.5);
          box-shadow: 0 20px 50px rgba(79, 70, 229, 0.25);
          background: rgba(255,255,255,0.06);
        }

        .feature-card:hover::before { opacity: 1; }

        .feature-icon {
          position: relative;
          z-index: 1;
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          margin-bottom: 1.25rem;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(79,70,229,0.25), rgba(6,182,212,0.25));
          border: 1px solid rgba(255,255,255,0.12);
          transition: transform 0.35s, background 0.35s;
        }

        .feature-card:hover .feature-icon {
          transform: scale(1.08) rotate(-4deg);
          background: linear-gradient(135deg, #4F46E5, #06B6D4);
        }

        .feature-title {
          position: relative;
          z-index: 1;
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }

        .feature-desc {
          position: relative;
          z-index: 1;
          color: #94a3b8;
          line-height: 1.6;
        }

        /* Workflow Section */
        .workflow-section {
          padding: 6rem 4rem;
        }

        .workflow-steps {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          max-width: 600px;
          margin: 0 auto;
        }

        .workflow-step {
          background: rgba(255,255,255,0.05);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 2rem 3rem;
          display: flex;
          align-items: center;
          gap: 1.5rem;
          width: 100%;
          transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
        }

        .workflow-step:hover {
          transform: translateX(6px);
          border-color: rgba(79,70,229,0.4);
          box-shadow: 0 14px 40px rgba(79,70,229,0.18);
        }

        .workstep-number {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 800;
        }

        .workstep-text {
          font-size: 1.25rem;
          font-weight: 600;
        }

        .workflow-arrow {
          font-size: 2rem;
          color: #4F46E5;
        }

        /* Dashboard Preview */
        .dashboard-preview-section {
          padding: 6rem 4rem;
        }

        .dashboard-preview {
          max-width: 800px;
          margin: 0 auto;
        }

        .preview-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px;
          padding: 2rem;
        }

        .preview-header {
          margin-bottom: 2rem;
        }

        .preview-title {
          font-size: 1.5rem;
          font-weight: 700;
        }

        .preview-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .preview-stat-label {
          color: #94a3b8;
          font-size: 0.875rem;
          margin-bottom: 0.5rem;
        }

        .preview-stat-value {
          font-size: 2rem;
          font-weight: 800;
        }

        .preview-chart {
          height: 200px;
        }

        .preview-chart svg {
          width: 100%;
          height: 100%;
        }

        /* Why Choose Us */
        .why-choose-section {
          padding: 6rem 4rem;
        }

        .why-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        .why-card {
          background: rgba(255,255,255,0.035);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 2rem;
          transition: transform 0.35s cubic-bezier(.2,.8,.2,1), box-shadow 0.35s, border-color 0.35s;
        }

        .why-card:hover {
          transform: translateY(-6px);
          border-color: rgba(6, 182, 212, 0.45);
          box-shadow: 0 18px 45px rgba(6, 182, 212, 0.18);
        }

        .why-icon {
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.75rem;
          margin-bottom: 1rem;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(6,182,212,0.22), rgba(139,92,246,0.22));
          border: 1px solid rgba(255,255,255,0.12);
          transition: transform 0.3s;
        }

        .why-card:hover .why-icon { transform: scale(1.08) rotate(4deg); }

        .why-title {
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }

        .why-desc {
          color: #94a3b8;
          line-height: 1.55;
        }

        /* Stats Section */
        .stats-section {
          padding: 6rem 4rem;
          background: linear-gradient(135deg, rgba(79,70,229,0.1) 0%, rgba(6,182,212,0.1) 100%);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2rem;
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }

        .stat-number {
          font-size: 4rem;
          font-weight: 800;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 0.5rem;
        }

        .stat-label {
          font-size: 1.1rem;
          color: #cbd5e1;
        }

        /* Testimonials */
        .testimonials-section {
          padding: 6rem 4rem;
        }

        .testimonials-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .testimonial-card {
          background: rgba(255,255,255,0.045);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 2rem;
          transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
        }

        .testimonial-card:hover {
          transform: translateY(-6px);
          border-color: rgba(139,92,246,0.4);
          box-shadow: 0 18px 45px rgba(139,92,246,0.18);
        }

        .testimonial-text {
          font-size: 1.1rem;
          line-height: 1.7;
          margin-bottom: 1.5rem;
          color: #e2e8f0;
        }

        .testimonial-author {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .author-avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 700;
        }

        .author-name {
          font-weight: 700;
        }

        .author-role {
          color: #94a3b8;
          font-size: 0.875rem;
        }

        /* CTA Section */
        .cta-section {
          padding: 6rem 4rem;
          text-align: center;
        }

        .cta-content {
          position: relative;
          max-width: 800px;
          margin: 0 auto;
          background: linear-gradient(135deg, rgba(79,70,229,0.2) 0%, rgba(6,182,212,0.2) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 32px;
          padding: 4rem;
          overflow: hidden;
        }

        .cta-content::before {
          content: '';
          position: absolute;
          top: -50%; left: 50%;
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%);
          transform: translateX(-50%);
          pointer-events: none;
        }

        .cta-title {
          font-size: 3rem;
          font-weight: 800;
          margin-bottom: 1rem;
        }

        .cta-subtitle {
          font-size: 1.25rem;
          color: #94a3b8;
          margin-bottom: 2rem;
        }

        .cta-btn {
          position: relative;
          z-index: 1;
          padding: 1.25rem 3rem;
          border-radius: 16px;
          border: none;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          color: #fff;
          font-size: 1.25rem;
          font-weight: 700;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.3s, box-shadow 0.3s;
        }

        .cta-btn::after {
          content: '';
          position: absolute;
          top: 0; left: -60%;
          width: 40%; height: 100%;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-20deg);
          transition: left 0.6s ease;
        }

        .cta-btn:hover::after { left: 130%; }

        .cta-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 15px 50px rgba(79, 70, 229, 0.5);
        }

        /* Footer */
        .landing-footer {
          padding: 4rem;
          border-top: 1px solid rgba(255,255,255,0.1);
        }

        .footer-content {
          display: flex;
          justify-content: space-between;
          max-width: 1400px;
          margin: 0 auto 3rem;
        }

        .footer-brand {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .footer-brand img {
          height: 36px;
        }

        .footer-name {
          font-size: 1.5rem;
          font-weight: 700;
        }

        .footer-tagline {
          color: #94a3b8;
        }

        .footer-links {
          display: flex;
          gap: 4rem;
        }

        .footer-column h4 {
          font-size: 1rem;
          font-weight: 700;
          margin-bottom: 1rem;
        }

        .footer-column a {
          display: block;
          color: #94a3b8;
          text-decoration: none;
          margin-bottom: 0.75rem;
          transition: color 0.3s;
        }

        .footer-column a:hover {
          color: #fff;
        }

        .footer-bottom {
          text-align: center;
          color: #64748b;
          padding-top: 2rem;
          border-top: 1px solid rgba(255,255,255,0.1);
        }

        /* Responsive */
        @media (max-width: 1200px) {
          .features-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          
          .why-grid, .testimonials-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .landing-nav {
            padding: 1rem 2rem;
          }
          
          .nav-links {
            gap: 1rem;
          }
          
          .nav-links a {
            display: none;
          }
          
          .hero-section {
            padding: 8rem 2rem 4rem;
          }
          
          .hero-title {
            font-size: 2.5rem;
          }
          
          .hero-buttons {
            flex-direction: column;
          }
          
          .mockup-cards {
            grid-template-columns: repeat(2, 1fr);
          }
          
          .mockup-charts {
            grid-template-columns: 1fr;
          }
          
          .features-grid, .why-grid, .testimonials-grid, .stats-grid {
            grid-template-columns: 1fr;
          }
          
          .preview-stats {
            grid-template-columns: 1fr;
          }
          
          .footer-content {
            flex-direction: column;
            gap: 2rem;
          }
          
          .footer-links {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
};

export default LandingPage;

