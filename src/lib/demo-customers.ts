// Fictional sample records for the public preview only.
export const demoCustomers = [
  {
    id: "alex",
    status: "sent" as const,
    roNumber: 10042,
    name: "Alex Example",
    asset: "2019 Ford F-150",
    contact: "(210) 555-0100",
    email: "alex@example.test",
    address: "100 Example Lane, San Antonio, TX 78201",
  },
  {
    id: "jordan",
    status: "in_progress" as const,
    roNumber: 10043,
    name: "Jordan Sample",
    asset: "2022 Toyota Camry",
    contact: "(210) 555-0111",
    email: "jordan@example.test",
    address: "200 Example Lane, San Antonio, TX 78201",
  },
  {
    id: "taylor",
    status: "paid" as const,
    roNumber: 10044,
    name: "Taylor Demo",
    asset: "2021 Honda Civic",
    contact: "(210) 555-0122",
    email: "taylor@example.test",
    address: "300 Example Lane, San Antonio, TX 78201",
  },
  {
    id: "morgan",
    status: "won" as const,
    roNumber: 10045,
    name: "Morgan Test",
    asset: "2023 Ford Explorer",
    contact: "(210) 555-0133",
    email: "morgan@example.test",
    address: "400 Example Lane, San Antonio, TX 78201",
  },
];

export type DemoCustomer = (typeof demoCustomers)[number];
