import { MockFactory } from "../../test/mocks/MockFactory"
import { MessageConfig } from "../config/MessageConfig"
import { MessageFlag } from "../config/MessageFlag"
import { plainToClass } from "class-transformer"
import { MessageProcessor } from "./MessageProcessor"

const md = MockFactory.newMockObjects()
const gasContext = MockFactory.newGasContextMock(md)

it("should match messages with matching parameters", () => {
  const matchExamples = [
    {
      config: {
        from: "from[0-1]@example.com",
      },
      matched: ["message-1"],
    },
    {
      config: {
        from: "from[2-9]@example.com",
      },
      matched: ["message-2"],
    },
    {
      config: {
        to: "to.*@example.com",
      },
      matched: ["message-1", "message-2"],
    },
    {
      config: {
        to: "not-to.*@example.com",
      },
      matched: [],
    },
    {
      config: {
        subject: "message-.*",
      },
      matched: ["message-1", "message-2"],
    },
    {
      config: {
        subject: "message-2",
      },
      matched: ["message-2"],
    },
    {
      config: {
        is: [MessageFlag.UNREAD],
      },
      matched: ["message-1"],
    },
    {
      config: {
        is: [MessageFlag.READ],
      },
      matched: ["message-2"],
    },
    {
      config: {
        is: [MessageFlag.UNSTARRED],
      },
      matched: ["message-1"],
    },
    {
      config: {
        is: [MessageFlag.STARRED],
      },
      matched: ["message-2"],
    },
  ]
  const mockedThread = MockFactory.newThreadMock({
    messages: [
      {
        from: "from1@example.com",
        subject: "message-1",
        to: "to1@example.com",
        isStarred: false,
        isUnread: true,
      },
      {
        from: "from2@example.com",
        subject: "message-2",
        to: "to2@example.com",
        isStarred: true,
        isUnread: false,
      },
    ],
  })
  for (let i = 0; i < matchExamples.length; i++) {
    const e = matchExamples[i]
    const messageConfig = plainToClass(MessageConfig, {
      type: "messages",
      match: e.config,
    })
    const res = []
    for (const m of mockedThread.getMessages()) {
      const messageProcessor = new MessageProcessor(
        MockFactory.newThreadContextMock(
          MockFactory.newProcessingContextMock(gasContext)
        )
      )
      if (messageProcessor.matches(messageConfig, m)) {
        res.push(m.getSubject())
      }
    }
    expect(`${i}: ${res}`).toEqual(`${i}: ${e.matched}`)
  }
})
