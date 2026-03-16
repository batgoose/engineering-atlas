import { codeWindow } from '@atlas/ui/styles';

export function CodeWindow({
  filename,
  children,
}: {
  filename: string;
  children: React.ReactNode;
}) {
  return (
    <div className={codeWindow.wrapper}>
      <div className={codeWindow.header}>
        <div className={codeWindow.controls}>
          <div className={codeWindow.dotRed} />
          <div className={codeWindow.dotYellow} />
          <div className={codeWindow.dotGreen} />
        </div>
        <span className={codeWindow.filename}>{filename}</span>
      </div>
      <div className={codeWindow.content}>
        <pre>
          <code>{children}</code>
        </pre>
      </div>
    </div>
  );
}
