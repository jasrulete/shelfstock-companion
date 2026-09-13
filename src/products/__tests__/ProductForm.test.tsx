import { fireEvent, render, screen } from '@testing-library/react-native';
import ProductForm from '../ProductForm';

/**
 * Roadmap Phase 3, accessibility: each input carries the same accessible
 * name as its visible label, so TalkBack reads "Price (USD), edit box"
 * rather than "edit box" seven times over.
 */
const LABELS = ['Name', 'Description', 'Price (USD)', 'Category', 'Stock', 'Image URL', 'Barcode'];

it('exposes every field under its visible label', async () => {
  await render(<ProductForm mode="create" submitLabel="Save" busy={false} onSubmit={jest.fn()} />);
  for (const label of LABELS) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

it('submits what was typed into the labelled fields, parsed', async () => {
  const onSubmit = jest.fn();
  await render(<ProductForm mode="create" submitLabel="Save" busy={false} onSubmit={onSubmit} />);

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

it('refuses a blank price instead of submitting the product as free', async () => {
  const onSubmit = jest.fn();
  await render(<ProductForm mode="create" submitLabel="Save" busy={false} onSubmit={onSubmit} />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'Mug');
  await fireEvent.changeText(screen.getByLabelText('Category'), 'Kitchen');
  await fireEvent.press(screen.getByText('Save'));

  expect(await screen.findByText('Price must be a non-negative number')).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

// C-INV-8: stock moves by delta through adjust-stock, never by PUT. An edit
// that carried an absolute count could be queued alongside stepper presses on
// the same product and, replayed in parallel with them, land on top of what
// they moved. So an edit shows the count and never submits one.
it('in edit mode shows the count read-only and submits no stock at all', async () => {
  const onSubmit = jest.fn();
  await render(
    <ProductForm
      mode="edit"
      initial={{ name: 'Mug', price: 9.5, category: 'Kitchen', stock: 5 }}
      submitLabel="Save changes"
      busy={false}
      onSubmit={onSubmit}
    />
  );

  expect(screen.queryByLabelText('Stock')).toBeNull();
  expect(screen.getByText(/Stock: 5/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Big Mug');
  await fireEvent.press(screen.getByText('Save changes'));

  expect(onSubmit).toHaveBeenCalledTimes(1);
  const submitted = onSubmit.mock.calls[0][0];
  expect(submitted).not.toHaveProperty('stock');
  expect(submitted).toMatchObject({ name: 'Big Mug', price: 9.5, category: 'Kitchen' });
});

it('refuses a blank stock count instead of submitting the product with none', async () => {
  const onSubmit = jest.fn();
  await render(<ProductForm mode="create" submitLabel="Save" busy={false} onSubmit={onSubmit} />);

  await fireEvent.changeText(screen.getByLabelText('Name'), 'Mug');
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '9.50');
  await fireEvent.changeText(screen.getByLabelText('Category'), 'Kitchen');
  await fireEvent.changeText(screen.getByLabelText('Stock'), '');
  await fireEvent.press(screen.getByText('Save'));

  expect(await screen.findByText('Stock must be a whole number')).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});
