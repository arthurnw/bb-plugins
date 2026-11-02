import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { computeCost } from "./sessions.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    cost: (input) => computeCost(input),
  },
});
