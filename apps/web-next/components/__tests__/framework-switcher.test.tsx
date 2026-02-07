// apps/web-next/components/__tests__/framework-switcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FrameworkSwitcher } from '../framework-switcher';

// Mock the UI contracts
vi.mock('@atlas/ui/contracts', () => ({
  getFrameworkOptions: () => [
    { id: 'next', name: 'Next.js', icon: '▲', active: true },
    { id: 'angular', name: 'Angular', icon: 'A', active: false },
    { id: 'vue', name: 'Vue', icon: 'V', active: false },
    { id: 'svelte', name: 'Svelte', icon: 'S', active: false },
  ],
}));

describe('FrameworkSwitcher', () => {
  it('renders without crashing', () => {
    const { container } = render(<FrameworkSwitcher />);
    expect(container).toBeTruthy();
  });

  it('shows the current framework (Next.js)', () => {
    render(<FrameworkSwitcher />);
    
    const currentFramework = screen.getByText('Next.js');
    expect(currentFramework).toBeInTheDocument();
  });

  it('shows the current framework icon', () => {
    render(<FrameworkSwitcher />);
    
    const icon = screen.getAllByText('▲')[0]; // First instance
    expect(icon).toBeInTheDocument();
  });

  it('dropdown is hidden by default', () => {
    render(<FrameworkSwitcher />);
    
    // "View in" text should not be visible initially
    expect(screen.queryByText('View in')).not.toBeInTheDocument();
  });

  it('opens dropdown when clicked', async () => {
    const user = userEvent.setup();
    render(<FrameworkSwitcher />);
    
    const button = screen.getByRole('button', { name: /Next.js/i });
    await user.click(button);
    
    // Dropdown should now be visible
    expect(screen.getByText('View in')).toBeInTheDocument();
    expect(screen.getByText('Angular')).toBeInTheDocument();
    expect(screen.getByText('Vue')).toBeInTheDocument();
    expect(screen.getByText('Svelte')).toBeInTheDocument();
  });

  it('shows "soon" for inactive frameworks', async () => {
    const user = userEvent.setup();
    render(<FrameworkSwitcher />);
    
    const button = screen.getByRole('button', { name: /Next.js/i });
    await user.click(button);
    
    // Should show "soon" for inactive frameworks
    const soonLabels = screen.getAllByText('soon');
    expect(soonLabels).toHaveLength(3); // Angular, Vue, Svelte
  });

  it('shows checkmark for active framework', async () => {
    const user = userEvent.setup();
    render(<FrameworkSwitcher />);
    
    const button = screen.getByRole('button', { name: /Next.js/i });
    await user.click(button);
    
    // Should show checkmark for Next.js
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('disables inactive framework buttons', async () => {
    const user = userEvent.setup();
    render(<FrameworkSwitcher />);
    
    const mainButton = screen.getByRole('button', { name: /Next.js/i });
    await user.click(mainButton);
    
    const buttons = screen.getAllByRole('button');
    const angularButton = buttons.find(btn => btn.textContent?.includes('Angular'));
    
    expect(angularButton).toBeDisabled();
  });

  it('closes dropdown when active framework is clicked', async () => {
    const user = userEvent.setup();
    render(<FrameworkSwitcher />);
    
    // Open dropdown
    const mainButton = screen.getByRole('button', { name: /Next.js/i });
    await user.click(mainButton);
    expect(screen.getByText('View in')).toBeInTheDocument();
    
    // Click Next.js in dropdown (active framework)
    const buttons = screen.getAllByRole('button');
    const nextButton = buttons.find(btn => 
      btn.textContent?.includes('Next.js') && btn.textContent?.includes('✓')
    );
    await user.click(nextButton!);
    
    // Dropdown should close
    expect(screen.queryByText('View in')).not.toBeInTheDocument();
  });
});
