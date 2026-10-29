// bb's chat renders inside this plugin's page, so this plugin's utility
// classes also apply to it. A shorthand the plugin's sheet emits (px-4) loads
// after bb's sheet and overrides a longhand bb pairs with it (pr-14), which
// hid the reply box's collapse caret under its text. Listing the longhands
// here makes Tailwind emit them too, after the shorthands, so bb's pairs
// resolve the same way inside the canvas as everywhere else.
//
// Tailwind finds these by scanning this file; nothing imports it at runtime.
export const TAILWIND_LONGHANDS = `
  pt-0 pt-px pt-0.5 pt-1 pt-1.5 pt-2 pt-2.5 pt-3 pt-3.5 pt-4 pt-5 pt-6 pt-7 pt-8 pt-9 pt-10 pt-11
  pt-12 pt-14 pt-16 pt-20 pt-24 pr-0 pr-px pr-0.5 pr-1 pr-1.5 pr-2 pr-2.5 pr-3 pr-3.5 pr-4 pr-5
  pr-6 pr-7 pr-8 pr-9 pr-10 pr-11 pr-12 pr-14 pr-16 pr-20 pr-24 pb-0 pb-px pb-0.5 pb-1 pb-1.5 pb-2
  pb-2.5 pb-3 pb-3.5 pb-4 pb-5 pb-6 pb-7 pb-8 pb-9 pb-10 pb-11 pb-12 pb-14 pb-16 pb-20 pb-24 pl-0
  pl-px pl-0.5 pl-1 pl-1.5 pl-2 pl-2.5 pl-3 pl-3.5 pl-4 pl-5 pl-6 pl-7 pl-8 pl-9 pl-10 pl-11 pl-12
  pl-14 pl-16 pl-20 pl-24 ps-0 ps-px ps-0.5 ps-1 ps-1.5 ps-2 ps-2.5 ps-3 ps-3.5 ps-4 ps-5 ps-6 ps-7
  ps-8 ps-9 ps-10 ps-11 ps-12 ps-14 ps-16 ps-20 ps-24 pe-0 pe-px pe-0.5 pe-1 pe-1.5 pe-2 pe-2.5
  pe-3 pe-3.5 pe-4 pe-5 pe-6 pe-7 pe-8 pe-9 pe-10 pe-11 pe-12 pe-14 pe-16 pe-20 pe-24 mt-0 mt-px
  mt-0.5 mt-1 mt-1.5 mt-2 mt-2.5 mt-3 mt-3.5 mt-4 mt-5 mt-6 mt-7 mt-8 mt-9 mt-10 mt-11 mt-12 mt-14
  mt-16 mt-20 mt-24 mr-0 mr-px mr-0.5 mr-1 mr-1.5 mr-2 mr-2.5 mr-3 mr-3.5 mr-4 mr-5 mr-6 mr-7 mr-8
  mr-9 mr-10 mr-11 mr-12 mr-14 mr-16 mr-20 mr-24 mb-0 mb-px mb-0.5 mb-1 mb-1.5 mb-2 mb-2.5 mb-3
  mb-3.5 mb-4 mb-5 mb-6 mb-7 mb-8 mb-9 mb-10 mb-11 mb-12 mb-14 mb-16 mb-20 mb-24 ml-0 ml-px ml-0.5
  ml-1 ml-1.5 ml-2 ml-2.5 ml-3 ml-3.5 ml-4 ml-5 ml-6 ml-7 ml-8 ml-9 ml-10 ml-11 ml-12 ml-14 ml-16
  ml-20 ml-24 ms-0 ms-px ms-0.5 ms-1 ms-1.5 ms-2 ms-2.5 ms-3 ms-3.5 ms-4 ms-5 ms-6 ms-7 ms-8 ms-9
  ms-10 ms-11 ms-12 ms-14 ms-16 ms-20 ms-24 me-0 me-px me-0.5 me-1 me-1.5 me-2 me-2.5 me-3 me-3.5
  me-4 me-5 me-6 me-7 me-8 me-9 me-10 me-11 me-12 me-14 me-16 me-20 me-24
`;
