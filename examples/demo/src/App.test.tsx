import { render, screen } from '@testing-library/react'
import App from './App'

describe('demo app', () => {
  it('renders without entering a render loop', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: /account risk queue for 120,000 live rows/i,
      }),
    ).toBeInTheDocument()
  })
})
