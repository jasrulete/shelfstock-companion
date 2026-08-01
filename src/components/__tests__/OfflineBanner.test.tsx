jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import OfflineBanner from '../OfflineBanner';

const netInfoMock = useNetInfo as jest.Mock;

it('renders nothing while online', async () => {
  netInfoMock.mockReturnValue({ isConnected: true });
  await render(<OfflineBanner />);
  expect(screen.queryByText(/offline/i)).toBeNull();
});

it('shows the banner while offline', async () => {
  netInfoMock.mockReturnValue({ isConnected: false });
  await render(<OfflineBanner />);
  expect(screen.getByText(/offline — showing cached data/i)).toBeTruthy();
});
