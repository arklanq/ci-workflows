import { createSelectRunnerHandler } from "../src/select-runner.js";

const selectRunner = createSelectRunnerHandler();

export const POST = selectRunner;
export const GET = selectRunner;
