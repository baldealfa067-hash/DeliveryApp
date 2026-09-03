import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Star, Phone, ArrowRight, CheckCircle2, Shield, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import heroBg from "@/assets/hero-bg.jpg";
import logo from "@/assets/logo.png";

const Landing = () => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/explorar?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate("/explorar");
    }
  };

  const steps = [
    {
      number: "01",
      icon: Search,
      title: t("landing.step1Title"),
      desc: t("landing.step1Desc"),
    },
    {
      number: "02",
      icon: Phone,
      title: t("landing.step2Title"),
      desc: t("landing.step2Desc"),
    },
    {
      number: "03",
      icon: Star,
      title: t("landing.step3Title"),
      desc: t("landing.step3Desc"),
    },
  ];

  const benefits = [
    { icon: Shield, title: t("landing.trust"), desc: t("landing.trustDesc") },
    { icon: Clock, title: t("landing.speed"), desc: t("landing.speedDesc") },
    { icon: Users, title: t("landing.community"), desc: t("landing.communityDesc") },
  ];

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Bornaal" className="h-8 w-auto" />
            <span className="text-white font-bold text-sm hidden sm:inline">{t("landing.bornaal")}</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link to="/sobre" className="text-xs sm:text-sm text-white/80 hover:text-white transition-colors hidden sm:inline">{t("landing.about")}</Link>
            <Link to="/termos" className="text-xs sm:text-sm text-white/80 hover:text-white transition-colors hidden sm:inline">{t("landing.terms")}</Link>
            <Link to="/privacidade" className="text-xs sm:text-sm text-white/80 hover:text-white transition-colors hidden sm:inline">{t("landing.privacy")}</Link>
            <Link to="/login" className="text-xs sm:text-sm text-white/80 hover:text-white transition-colors">{t("landing.login")}</Link>
            <LanguageSelector />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden min-h-[85vh] flex items-center">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/90 via-foreground/75 to-foreground/60" />
        <div className="relative w-full max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/15 rounded-full px-4 py-1.5 mb-8">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-white/80 text-xs font-medium tracking-wide uppercase">{t("landing.platform")}</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-5 tracking-tight drop-shadow-lg">
            Born<span className="text-primary">aal</span>
          </h1>
          <p className="text-white/70 text-lg md:text-xl mb-8 max-w-md mx-auto leading-relaxed">
            {t("landing.heroTitle")}
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("landing.searchPlaceholder")}
                className="pl-12 pr-24 h-13 rounded-full bg-white/95 backdrop-blur-sm border-0 text-foreground text-sm shadow-xl"
              />
              <Button
                type="submit"
                size="sm"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-5"
              >
                {t("landing.search")}
              </Button>
            </div>
          </form>

          <div className="flex justify-center">
            <Link to="/inicio">
              <Button size="lg" className="rounded-full px-8 gap-2 text-base font-semibold shadow-xl">
                {t("landing.findProviders")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="mt-4 flex justify-center">
            <Link to="/login?tab=registar">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-8 gap-2 text-base font-semibold bg-white/10 backdrop-blur-sm border-white/40 text-white hover:bg-white hover:text-foreground"
              >
                {t("landing.becomeProvider")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits strip */}
      <section className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {benefits.map((b) => (
              <div key={b.title} className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">{b.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-2xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <span className="text-xs font-semibold text-primary tracking-widest uppercase">{t("landing.process")}</span>
          <h2 className="text-3xl font-bold text-foreground mt-2">{t("landing.howItWorks")}</h2>
          <p className="text-muted-foreground mt-3 max-w-md mx-auto">
            {t("landing.howItWorksDesc")}
          </p>
        </div>

        <div className="flex flex-col gap-0">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              {i < steps.length - 1 && (
                <div className="absolute left-[27px] top-[56px] w-px h-[calc(100%-32px)] bg-border" />
              )}
              <div className="flex gap-6 pb-12 last:pb-0">
                <div className="shrink-0">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <step.icon className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <div className="pt-1">
                  <span className="text-[11px] font-bold text-primary tracking-widest">{step.number}</span>
                  <h3 className="text-xl font-bold text-foreground mt-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features detail */}
      <section className="bg-card border-y border-border">
        <div className="max-w-2xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold text-primary tracking-widest uppercase">{t("landing.benefits")}</span>
            <h2 className="text-3xl font-bold text-foreground mt-2">{t("landing.whyBornaal")}</h2>
          </div>
          <div className="grid gap-4">
            {[
              t("landing.benefit1"),
              t("landing.benefit2"),
              t("landing.benefit3"),
              t("landing.benefit4"),
              t("landing.benefit5"),
              t("landing.benefit6"),
            ].map((text) => (
              <div key={text} className="flex items-start gap-3 p-4 rounded-xl bg-background border border-border/50">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-foreground font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold text-foreground mb-3">
          {t("landing.ready")}
        </h2>
        <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
          {t("landing.readyDesc")}
        </p>
        <div className="flex justify-center">
          <Link to="/inicio">
            <Button size="lg" className="rounded-full px-8 gap-2 font-semibold shadow-lg">
              {t("landing.exploreProviders")} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-2xl mx-auto px-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
            <img src={logo} alt="Bornaal" className="h-8 w-auto" />
            <div className="flex gap-4 text-xs">
              <Link to="/sobre" className="text-muted-foreground hover:text-foreground transition-colors">{t("landing.about")}</Link>
              <Link to="/termos" className="text-muted-foreground hover:text-foreground transition-colors">{t("landing.terms")}</Link>
              <Link to="/privacidade" className="text-muted-foreground hover:text-foreground transition-colors">{t("landing.privacy")}</Link>
              <Link to="/login" className="text-muted-foreground hover:text-foreground transition-colors">{t("landing.login")}</Link>
              <Link to="/admin-moderacao" className="text-muted-foreground/50 hover:text-foreground transition-colors">·</Link>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            {t("landing.copyright")}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
