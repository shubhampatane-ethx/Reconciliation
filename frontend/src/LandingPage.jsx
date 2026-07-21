
import React, { useState } from 'react';
import LoginPage from './LoginPage';

const LandingPage = () => {
  const [showLogin, setShowLogin] = useState(false);

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
          margin: 0 auto;
          animation: heroFadeUp 0.9s cubic-bezier(.2,.8,.2,1) both;
        }

        @keyframes heroFadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }

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
          
          .why-grid {
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
          
          .features-grid, .why-grid {
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

