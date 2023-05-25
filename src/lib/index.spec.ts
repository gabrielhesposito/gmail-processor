import { PartialDeep } from "type-fest"
import { runWithV1Config } from "."
import { MockFactory, Mocks } from "../test/mocks/MockFactory"
import { RunMode } from "./Context"
import { Config, jsonToConfig } from "./config/Config"
import { GmailProcessor } from "./processors/GmailProcessor"

let configJson: PartialDeep<Config>
let mocks: Mocks
let gmailProcessor: GmailProcessor

beforeEach(() => {
  configJson = MockFactory.newDefaultConfigJson()
  const config = jsonToConfig(configJson)
  mocks = MockFactory.newMocks(config, RunMode.DRY_RUN)
  gmailProcessor = new GmailProcessor()
})

describe("run", () => {
  it("test", () => {
    const result = gmailProcessor.runWithJson(configJson, mocks.envContext)
    expect(result.status).toEqual("ok")
  })
})

describe("runWithV1ConfigJson", () => {
  it("should process a v1 config JSON", () => {
    const v1config = MockFactory.newDefaultV1ConfigJson()
    const result = runWithV1Config(
      v1config,
      RunMode.DRY_RUN,
      MockFactory.newEnvContextMock(),
    )
    expect(result.status).toEqual("ok")
  })
})
