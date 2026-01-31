import Link from 'next/link';
import { buildHomePageProps } from '@atlas/ui/contracts';
import { layout, typography, buttons, cards, badges, hero as heroStyles } from '@atlas/ui/styles';
import type { HeroProps, CategoryCardProps, ApiMethodCardProps } from '@atlas/ui/contracts';

export default function HomePage() {
  const props = buildHomePageProps();

  return (
    <div className={layout.page}>
      <Hero {...props.hero} />
      
      <section className={layout.sectionWithBorder}>
        <div className={layout.container}>
          <SectionHeader 
            title={props.skillsSectionTitle} 
            link={props.skillsSectionLink} 
          />
          <div className={layout.grid3}>
            {props.categories.map((cat) => (
              <CategoryCard key={cat.name} {...cat} />
            ))}
          </div>
        </div>
      </section>

      <section className={layout.sectionAlt}>
        <div className={layout.container}>
          <h2 className={`${typography.h2} mb-8`}>{props.apiSectionTitle}</h2>
          <div className={layout.grid4}>
            {props.apiMethods.map((method) => (
              <ApiMethodCard key={method.title} {...method} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Hero({ greeting, headline, subhead, description, primaryCta, secondaryCta }: HeroProps) {
  return (
    <section className={heroStyles.section}>
      <div className={layout.container}>
        <div className={heroStyles.content}>
          <p className={heroStyles.greeting}>{greeting}</p>
          <h1 className={heroStyles.headline}>
            <span className={heroStyles.headlineGradient}>{headline}</span>
            <br />
            {subhead}
          </h1>
          <p className={heroStyles.description}>{description}</p>
          <div className={heroStyles.ctaContainer}>
            <Link href={primaryCta.href} className={buttons.primary}>
              {primaryCta.label}
            </Link>
            <Link href={secondaryCta.href} className={buttons.secondary}>
              {secondaryCta.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, link }: { title: string; link: { href: string; label: string } }) {
  return (
    <div className={`${layout.flexBetween} mb-8`}>
      <h2 className={typography.h2}>{title}</h2>
      <Link href={link.href} className={`${typography.link} text-sm`}>
        {link.label}
      </Link>
    </div>
  );
}

function CategoryCard({ name, description, href }: CategoryCardProps) {
  return (
    <Link href={href} className={cards.baseHover}>
      <h3 className={`${typography.h4} mb-2`}>{name}</h3>
      <p className={typography.bodySmall}>{description}</p>
    </Link>
  );
}

function ApiMethodCard({ title, description, status }: ApiMethodCardProps) {
  const statusBadge = {
    active: badges.success,
    building: badges.warning,
    planned: badges.neutral,
  }[status];

  const statusLabel = {
    active: 'Live',
    building: 'Building',
    planned: 'Planned',
  }[status];

  return (
    <div className={cards.onDark}>
      <div className={`${layout.flexBetween} mb-2`}>
        <h3 className={typography.h4}>{title}</h3>
        <span className={statusBadge}>{statusLabel}</span>
      </div>
      <p className={typography.bodySmall}>{description}</p>
    </div>
  );
}
