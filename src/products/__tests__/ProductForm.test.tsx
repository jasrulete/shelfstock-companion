import { fireEvent, render, screen } from '@testing-library/react-native';
import ProductForm from '../ProductForm';

/**
 * Roadmap Phase 3, accessibility: each input carries the same accessible
 * name as its visible label, so TalkBack reads "Price (USD), edit box"
 * rather than "edit box" seven times over.
 */
const LABELS = ['Name', 'Description', 'Price (USD)', 'Category', 'Stock', 'Image URL', 'Barcode'];

it('exposes every field under its visible label', async () => {
  await render(<ProductForm submitLabel="Save" busy={false} onSubmit={jest.fn()} />);
  for (const label of LABELS) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

it('submits what was typed into the labelled fields, parsed', async () => {
  const onSubmit = jest.fn();
  await render(<ProductForm submitLabel="Save" busy={false} onSubmit={onSubmit} />);

  await fireEvent.changeText(screen.getByLabelText('Name'), ' Mug ');
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '9.50');
  await fireEvent.changeText(screen.getByLabelText('Category'), 'Kitchen');
  await fireEvent.changeText(screen.getByLabelText('Stock'), '3');
  await fireEvent.press(screen.getByText('Save'));

  expect(onSubmit).toHaveBeenCalledWith({
    name: 'Mug',
    description: null,
    price: 9.5,
    category: 'Kitchen',
    stock: 3,
    image_url: null,
    barcode: null,
  });
});
