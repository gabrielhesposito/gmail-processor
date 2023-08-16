import { PartialDeep } from "type-fest"
import { ConflictStrategy } from "../../adapter/GDriveAdapter"
import {
  newAttachmentActionConfig,
  newMessageActionConfig,
  newThreadActionConfig,
} from "../ActionConfig"
import { AttachmentConfig } from "../AttachmentConfig"
import { Config, RequiredConfig, newConfig } from "../Config"
import {
  DEFAULT_GLOBAL_QUERY_NEWER_THAN,
  DEFAULT_GLOBAL_QUERY_PREFIX,
} from "../GlobalConfig"
import { MessageConfig } from "../MessageConfig"
import { MarkProcessedMethod } from "../SettingsConfig"
import {
  RequiredThreadConfig,
  ThreadConfig,
  newThreadConfig,
} from "../ThreadConfig"
import { V1Config, newV1Config } from "./V1Config"
import { V1Rule } from "./V1Rule"

export class V1ToV2Converter {
  public static convertDateFormat(format: string): string {
    // old format (from Google Apps Script Utilities): yyyy-MM-dd_HH-mm-ss
    // See https://docs.oracle.com/javase/7/docs/api/java/text/SimpleDateFormat.html
    // new format (from date-fns): yyyy-MM-dd_HH-mm-ss
    // See https://date-fns.org/v2.30.0/docs/format
    const convertedFormat = format.replace(/u/g, "i")
    const unsupportedFormatStrings = /[Fa]/
    const matches = convertedFormat.match(unsupportedFormatStrings)
    if (matches) {
      throw new Error(
        "Conversion of date format not possible - unsupported date format: " +
          matches[0],
      )
    }
    return convertedFormat
  }

  public static convertFromV1Pattern(
    s: string,
    dateKey: string,
    isPath: boolean,
  ) {
    const containsSingleQuotedStringRegex = /'([^'\n]+)'/g
    const legacyDateFormatRegex = /('([^']+)')?([^']+)('([^']+)')?/g
    if (s.replace(containsSingleQuotedStringRegex, "") !== "") {
      // Support original date format
      s = s.replace(
        legacyDateFormatRegex,
        `$2\${${dateKey}:olddateformat:$3}$5`,
      )
      const regexp = /:olddateformat:([^}]+)}/g
      const matches = s.matchAll(regexp)
      for (const match of matches) {
        if (match.length > 1) {
          const convertedFormat = this.convertDateFormat(match[1])
          s = s.replace(/:olddateformat:[^}]+}/g, `:format:${convertedFormat}}`)
        }
      }
    } else {
      s = s.replace(/'/g, "") // Eliminate all single quotes
    }
    s = s
      .replace(/%s/g, "${message.subject}") // Original subject syntax
      .replace(/%o/g, "${attachment.name}") // Alternative syntax (from PR #61)
      .replace(/%filename/g, "${attachment.name}") // Alternative syntax from issue #50
      .replace(/#SUBJECT#/g, "${message.subject}") // Alternative syntax (from PR #22)
      .replace(/#FILE#/g, "${attachment.name}") // Alternative syntax (from PR #22)
      .replace(/%d/g, "${threadConfig.index}") // Original subject syntax

    // Normalize path to form `/path1/path2`
    if (isPath && s !== "" && !s.startsWith("/")) {
      s = `/${s}`
    }
    if (isPath && s.endsWith("/")) {
      s = s.slice(0, -1)
    }
    return s
  }

  static getLocationFromRule(rule: V1Rule, defaultFilename: string): string {
    let filename
    if (rule.filenameFromRegexp) {
      filename = "${attachment.name.match.1}"
    } else if (rule.filenameTo) {
      filename = this.convertFromV1Pattern(
        rule.filenameTo,
        "message.date",
        false,
      )
    } else {
      filename = defaultFilename
    }
    let folder = ""
    if (rule.parentFolderId) {
      folder = `\${id:${rule.parentFolderId}}`
    }
    folder += this.convertFromV1Pattern(rule.folder, "message.date", true)
    return `${folder}/${filename}`
  }

  static v1RuleToV2ThreadConfig(rule: V1Rule): RequiredThreadConfig {
    const threadConfig: PartialDeep<ThreadConfig> = {}
    threadConfig.actions = []
    threadConfig.attachments = []
    threadConfig.messages = []
    threadConfig.match = {}
    const attachmentConfig: PartialDeep<AttachmentConfig> = {}
    const messageConfig: PartialDeep<MessageConfig> = {}
    messageConfig.actions = []
    attachmentConfig.match = {}
    attachmentConfig.actions = []

    // Old processing logic:
    // var gSearchExp  = config.globalFilter + " " + rule.filter + " -label:" + config.processedLabel;
    if (rule.filter) {
      threadConfig.match.query = rule.filter
    }
    // Old processing logic:
    // if (newerThan != "") {
    //   gSearchExp += " newer_than:" + config.newerThan;
    // }
    if (rule.newerThan && rule.newerThan != "") {
      threadConfig.match.query =
        (threadConfig.match.query ?? "") + ` newer_than:${rule.newerThan}`
    }
    // Old processing logic:
    // iterate threads:
    // if (rule.saveMessagePDF) {
    //   processMessageToPdf(message, rule, config);
    if (rule.saveMessagePDF) {
      messageConfig.actions.push(
        newMessageActionConfig({
          name: "message.storePDF",
          args: {
            location: this.getLocationFromRule(rule, "${message.subject}.pdf"),
            skipHeader: rule.skipPDFHeader === true,
          },
        }),
      )
      threadConfig.messages.push(messageConfig)
    } else {
      // Old processing logic:
      // } else {
      //   processMessage(message, rule, config);

      //     if (rule.filenameFromRegexp) {
      //       var re = new RegExp(rule.filenameFromRegexp);
      //       match = (attachment.getName()).match(re);
      //     }
      //     if (!match) {
      //       Logger.log("INFO:           Rejecting file '" + attachment.getName() + " not matching" + rule.filenameFromRegexp);
      //       continue;
      //     }
      // Handle filename filtering:
      if (rule.filenameFromRegexp) {
        attachmentConfig.match.name = rule.filenameFromRegexp
      }
      // Old processing logic:
      //     var folderName = Utilities.formatDate(messageDate, config.timezone, rule.folder.replace('%s', message.getSubject()));
      //     folderName = folderName.replace(':', '');
      //     Logger.log("Saving to folder" + folderName);
      //     var folder = getOrCreateFolder(folderName, rule.parentFolderId);
      //     var file = folder.createFile(attachment);
      //     var original_attachment_name = file.getName();
      //     var new_filename = rule.filenameTo.replace('%s',message.getSubject()).replace("%d", String(rule_counter++)).replace('%o', original_attachment_name)
      //     if (rule.filenameFrom && rule.filenameTo && rule.filenameFrom == file.getName()) {
      //       var final_attachment_name = Utilities.formatDate(messageDate, config.timezone, new_filename);
      //       Logger.log("INFO:           Renaming matched file '" + file.getName() + "' -> '" + final_attachment_name + "'");
      //       file.setName(final_attachment_name);
      //     }
      if (rule.filenameFrom && rule.filenameTo) {
        attachmentConfig.match.name = String(rule.filenameFrom).replace(
          /[\\^$*+?.()|[\]{}]/g,
          "\\$&",
        ) // TODO: Validate this regex!
        // Old processing logic:
        //     else if (rule.filenameTo) {
        //       var final_attachment_name = Utilities.formatDate(messageDate, config.timezone, new_filename);
        //       Logger.log("INFO:           Renaming '" + file.getName() + "' -> '" + final_attachment_name + "'");
        //       file.setName(final_attachment_name);
        //     }
      }
      // Old processing logic:
      //     file.setDescription("Mail title: " + message.getSubject() + "\nMail date: " + message.getDate() + "\nMail link: https://mail.google.com/mail/u/0/#inbox/" + message.getId());
      attachmentConfig.actions.push(
        newAttachmentActionConfig({
          name: "attachment.store",
          args: {
            conflictStrategy: ConflictStrategy.KEEP,
            description:
              "Mail title: ${message.subject}\nMail date: ${message.date}\nMail link: https://mail.google.com/mail/u/0/#inbox/${message.id}",
            location: this.getLocationFromRule(rule, "${attachment.name}"),
          },
        }),
      )
      threadConfig.attachments.push(attachmentConfig)
    }
    // Old processing logic:
    // }
    // if (doPDF) { // Generate a PDF document of a thread:
    //   processThreadToPdf(thread, rule, config);
    // }
    if (rule.saveThreadPDF) {
      threadConfig.actions.push(
        newThreadActionConfig({
          name: "thread.storePDF",
          args: {
            location: this.getLocationFromRule(
              rule,
              "${thread.firstMessageSubject}.pdf",
            ),
          },
        }),
      )
    }
    // Old processing logic:
    // if(rule.ruleLabel) {
    //   thread.addLabel(getOrCreateLabel(rule.ruleLabel));
    // }
    // thread.addLabel(label);
    if (rule.ruleLabel != "") {
      threadConfig.actions.push(
        newThreadActionConfig({
          name: "thread.addLabel",
          args: {
            label: rule.ruleLabel,
          },
        }),
      )
    }
    // Old processing logic:
    // if (doArchive) { // Archive a thread if required
    //   Logger.log("INFO:     Archiving thread '" + thread.getFirstMessageSubject() + "' ...");
    //   thread.moveToArchive();
    // }
    if (rule.archive) {
      threadConfig.actions.push(
        newThreadActionConfig({
          name: "thread.moveToArchive",
        }),
      )
    }
    const resultingThreadConfig = newThreadConfig(threadConfig)
    return resultingThreadConfig
  }

  static v1ConfigToV2ConfigJson(
    partialV1Config: PartialDeep<V1Config>,
  ): PartialDeep<Config> {
    const v1Config = newV1Config(partialV1Config)
    // const config = newConfig()
    // // Old processing logic:
    // // if (config.globalFilter===undefined) {
    // //   config.globalFilter = "has:attachment -in:trash -in:drafts -in:spam";
    // // }
    // config.global.thread.match.query =
    //   v1Config.globalFilter || "has:attachment -in:trash -in:drafts -in:spam"
    // // Old processing logic:
    // // var gSearchExp  = config.globalFilter + " " + rule.filter + " -label:" + config.processedLabel;
    // config.settings.markProcessedLabel = v1Config.processedLabel
    // config.settings.sleepTimeThreads = v1Config.sleepTime
    // config.settings.maxRuntime = v1Config.maxRuntime
    // config.global.thread.match.newerThan = v1Config.newerThan
    // config.settings.timezone = v1Config.timezone
    // v1Config.rules.forEach((rule) => {
    //   config.threads.push(this.v1RuleToV2ThreadConfig(rule))
    // })
    const threadConfigs = v1Config.rules.map((rule) =>
      this.v1RuleToV2ThreadConfig(rule),
    )
    const globalFilter = v1Config.globalFilter || DEFAULT_GLOBAL_QUERY_PREFIX
    const newerThan = v1Config.newerThan || DEFAULT_GLOBAL_QUERY_NEWER_THAN
    const configJson: PartialDeep<Config> = {
      global: {
        thread: {
          match: {
            query: `${globalFilter} newer_than:${newerThan}`,
          },
        },
      },
      settings: {
        markProcessedMethod: MarkProcessedMethod.ADD_THREAD_LABEL,
        markProcessedLabel: v1Config.processedLabel,
        sleepTimeThreads: v1Config.sleepTime,
        maxRuntime: v1Config.maxRuntime,
        timezone: v1Config.timezone,
      },
      threads: threadConfigs,
    }
    return configJson
  }

  static v1ConfigToV2Config(
    v1ConfigJson: PartialDeep<V1Config>,
  ): RequiredConfig {
    const configJson = this.v1ConfigToV2ConfigJson(v1ConfigJson)
    const config = newConfig(configJson)
    return config
  }
}