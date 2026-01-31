import { buildContactPageProps } from '@atlas/ui/contracts';
import {
  layout,
  typography,
  cards,
  buttons,
  inputs,
  contact as contactStyles,
} from '@atlas/ui/styles';

export const metadata = {
  title: 'Contact',
};

export default function ContactPage() {
  const props = buildContactPageProps();

  return (
    <div className={`${layout.page} py-12`}>
      <div className={layout.containerNarrow}>
        <h1 className={`${typography.h1} mb-4`}>{props.title}</h1>
        <p className={`${typography.bodyMuted} mb-12`}>{props.description}</p>

        {/* contact methods */}
        <div className={contactStyles.methodsContainer}>
          {props.methods.map((method) => (
            <a
              key={method.type}
              href={method.href}
              target={method.type !== 'email' ? '_blank' : undefined}
              rel={method.type !== 'email' ? 'noopener noreferrer' : undefined}
              className={cards.contactMethod}
            >
              <div className={cards.iconBox}>
                <span>{method.icon}</span>
              </div>
              <div>
                <p className={typography.h4}>{method.label}</p>
                <p className={typography.bodySmall}>{method.value}</p>
              </div>
            </a>
          ))}
        </div>

        {/* contact form */}
        <div className={contactStyles.formContainer}>
          <h2 className={`${typography.h4} mb-4`}>Send a Message</h2>
          <form className={contactStyles.formFields}>
            <div>
              <label htmlFor="name" className={typography.label}>
                Name
              </label>
              <input type="text" id="name" className={inputs.text} />
            </div>
            <div>
              <label htmlFor="email" className={typography.label}>
                Email
              </label>
              <input type="email" id="email" className={inputs.text} />
            </div>
            <div>
              <label htmlFor="message" className={typography.label}>
                Message
              </label>
              <textarea id="message" rows={4} className={inputs.textarea} />
            </div>
            <button type="submit" className={buttons.fullWidth}>
              Send Message
            </button>
          </form>
          {!props.formEnabled && (
            <p className={contactStyles.formNote}>Form submission not yet wired up.</p>
          )}
        </div>
      </div>
    </div>
  );
}
