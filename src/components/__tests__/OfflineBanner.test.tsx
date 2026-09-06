import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import OfflineBanner from '../OfflineBanner';

jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

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

it('keeps the banner out from under the status bar by padding for the top inset', async () => {
  netInfoMock.mockReturnValue({ isConnected: false });
  await render(<OfflineBanner />);
  const banner = screen.getByText(/offline — showing cached data/i);
  expect(StyleSheet.flatten(banner.props.style).paddingTop).toBe(40 + 6);
  expect(banner.props.accessibilityRole).toBe('alert');
});
