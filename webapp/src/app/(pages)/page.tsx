import Image from "next/image";
import Link from "next/link";
import { Button } from "@/src/components/ui/button";
import { Shield, Globe, CheckCircle, Coins, ArrowRight } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "zk-Wormholes",
    description:
      "Secretly deposit your assets into the shielded pool on any chain. Based on EIP-7503.",
  },
  {
    icon: Globe,
    title: "Cross-Chain Private Transfers",
    description:
      "Move assets between chains without ever leaving the shielded pool. Your transfers are shielded end-to-end across any supported network.",
  },
  {
    icon: CheckCircle,
    title: "Built-In Compliance",
    description:
      "All transfers are screened for illicit funds and excluded from the privacy realm.",
  },
  {
    icon: Coins,
    title: "Any Asset, Any Chain",
    description:
      "ERC-20s, NFTs, and any other token type. If it lives on-chain, Isekai can teleport it into the privacy realm.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <section className="w-full max-w-5xl mx-auto flex flex-col items-center text-center px-6 pt-20 pb-24 gap-8">
        <div className="relative">
          <div className="absolute inset-0 blur-3xl opacity-30 rounded-full bg-[#0d9488]" />
          <Image
            src="/logo.png"
            alt="Isekai"
            width={140}
            height={140}
            className="relative animate-float"
            priority
          />
        </div>

        <div className="space-y-4 max-w-2xl">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground">
            Isekai
          </h1>
          <p className="text-xl sm:text-2xl text-[#0d9488] font-medium">
            Teleport your assets into the privacy realm
          </p>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg mx-auto">
            A cross-chain privacy protocol powered by zk-wormholes. Shield any
            token, transfer privately between chains, and stay compliant — all
            in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Link href="/assets">
            <Button size="lg" className="h-14 px-8 text-base rounded-xl gap-2">
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <Link href="/wormholes">
            <Button
              variant="outline"
              size="lg"
              className="h-14 px-8 text-base rounded-xl"
            >
              View Wormholes
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="w-full max-w-5xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="glass rounded-2xl p-6 card-hover space-y-3"
            >
              <div className="w-11 h-11 rounded-xl bg-[#0d9488]/10 flex items-center justify-center">
                <feature.icon className="w-5 h-5 text-[#0d9488]" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="w-full max-w-5xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Wrap & Shield",
              description:
                "Deposit any supported token into Isekai. Your balance is encrypted and added to the shielded pool.",
            },
            {
              step: "2",
              title: "Transfer Privately",
              description:
                "Send shielded transfers or zk-wormholes whether on the same chain or across chains.",
            },
            {
              step: "3",
              title: "Unshield Anywhere",
              description:
                "Withdraw your tokens on any supported chain. Only you and the recipient know the details.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="relative glass rounded-2xl p-6 space-y-3"
            >
              <span className="text-4xl font-black text-[#0d9488]/20">
                {item.step}
              </span>
              <h3 className="text-lg font-semibold text-foreground">
                {item.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="w-full max-w-5xl mx-auto px-6 pb-24">
        <div className="glass rounded-2xl p-10 text-center space-y-4">
          <h2 className="text-2xl font-bold text-foreground">
            Ready to enter the other world?
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Connect your wallet, shield your assets, and start making private
            transfers across chains.
          </p>
          <Link href="/assets">
            <Button size="lg" className="h-14 px-10 text-base rounded-xl gap-2 mt-2">
              Get Started
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
