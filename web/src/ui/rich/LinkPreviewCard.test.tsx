// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LinkPreviewCard } from './LinkPreviewCard'

describe('LinkPreviewCard', () => {
  it('renderiza os metadados do link', () => {
    render(
      <LinkPreviewCard
        preview={{
          url: 'https://github.com',
          title: 'GitHub: Let’s build from here',
          description: 'GitHub is where over 100 million developers shape the future of software.',
          image: 'https://github.githubassets.com/assets/campaign-social-031d6161fa10.png',
          site_name: 'GitHub',
        }}
      />
    )

    expect(screen.getByText('GitHub: Let’s build from here')).toBeTruthy()
    expect(screen.getByText(/over 100 million developers/)).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com')
  })

  it('não renderiza nada se não houver título nem descrição', () => {
    const { container } = render(
      <LinkPreviewCard
        preview={{
          url: 'https://exemplo.com',
        }}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})