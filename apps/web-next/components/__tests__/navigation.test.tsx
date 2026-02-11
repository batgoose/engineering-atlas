// apps/web-next/components/__tests__/navigation.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Navigation } from '../navigation';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

// Mock the UI contracts
vi.mock('@atlas/sdk/contracts', () => ({
  buildNavigation: (pathname: string) => ({
    logoText: 'Engineering Atlas',
    items: [
      { href: '/', label: 'Home', isActive: pathname === '/' },
      { href: '/atlas', label: 'Atlas', isActive: pathname === '/atlas' },
      { href: '/demos', label: 'Demos', isActive: pathname === '/demos' },
      { href: '/about', label: 'About', isActive: pathname === '/about' },
      { href: '/contact', label: 'Contact', isActive: pathname === '/contact' },
    ],
  }),
}));

describe('Navigation', () => {
  it('renders without crashing', () => {
    const { container } = render(<Navigation />);
    expect(container).toBeTruthy();
  });

  it('renders the logo', () => {
    render(<Navigation />);
    const logo = screen.getByText('Engineering Atlas');
    expect(logo).toBeInTheDocument();
  });

  it('renders all navigation items', () => {
    render(<Navigation />);
    
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Atlas')).toBeInTheDocument();
    expect(screen.getByText('Demos')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
  });

  it('highlights the active page', () => {
    render(<Navigation />);
    
    const homeLink = screen.getByText('Home').closest('a');
    const atlasLink = screen.getByText('Atlas').closest('a');
    
    // Home and Atlas should have different classes (one active, one not)
    expect(homeLink?.className).not.toEqual(atlasLink?.className);
    
    // Active link should have solid background color
    expect(homeLink?.className).toContain('bg-slate-800');
  });

  it('renders mobile menu button', () => {
    render(<Navigation />);
    
    const mobileBtn = screen.getByRole('button');
    expect(mobileBtn).toBeInTheDocument();
  });

  it('renders all links with correct hrefs', () => {
    render(<Navigation />);
    
    const homeLink = screen.getByText('Home').closest('a');
    const atlasLink = screen.getByText('Atlas').closest('a');
    const demosLink = screen.getByText('Demos').closest('a');
    
    expect(homeLink).toHaveAttribute('href', '/');
    expect(atlasLink).toHaveAttribute('href', '/atlas');
    expect(demosLink).toHaveAttribute('href', '/demos');
  });
});
