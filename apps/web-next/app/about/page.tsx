import { buildAboutPageProps } from '@atlas/ui/contracts';
import { layout, typography, about as aboutStyles } from '@atlas/ui/styles';

export const metadata = {
  title: 'About',
};

export default function AboutPage() {
  const props = buildAboutPageProps();

  return (
    <div className={`${layout.page} py-12`}>
      <div className={layout.containerNarrow}>
        <h1 className={`${typography.h1} mb-8`}>{props.title}</h1>
        
        <div className={aboutStyles.prose}>
          <p className={aboutStyles.intro}>{props.intro}</p>

          {props.sections.map((section) => (
            <section key={section.title} className={aboutStyles.sectionSpacing}>
              <h2 className={`${typography.h3} mb-4`}>{section.title}</h2>
              <p className={typography.bodyMuted}>{section.content}</p>
            </section>
          ))}

          <section className={aboutStyles.sectionSpacing}>
            <h2 className={`${typography.h3} mb-4`}>Project Highlights</h2>
            <ul className="mt-4 space-y-2">
              {props.highlights.map((highlight) => (
                <li key={highlight} className={aboutStyles.highlightItem}>
                  <span className={aboutStyles.highlightIcon}>→</span>
                  <span className={typography.bodyMuted}>{highlight}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className={`${typography.h3} mb-4`}>Experience Timeline</h2>
            <div className="space-y-6">
              {props.timeline.map((job) => (
                <div key={job.company} className={aboutStyles.timelineEntry}>
                  <div className={aboutStyles.timelineYear}>{job.years}</div>
                  <div>
                    <p className={typography.h4}>{job.role}</p>
                    <p className={typography.bodySmall}>{job.company}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
