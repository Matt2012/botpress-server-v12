import { Logger } from 'botpress-module-sdk'
import { inject, injectable } from 'inversify'
import _ from 'lodash'
import Mustache from 'mustache'

import { TYPES } from '../../misc/types'
import ActionService from '../action/action-service'
import { runCode } from '../action/sandbox-launcher'

const BOT_ID = 'bot123'

type InstructionType = 'transition' | 'on-enter' | 'on-receive' | 'wait' | 'breakpoint'

/**
 * @property type The type of instruction
 * @property fn The function to execute
 * @property node The target node to transit to
 */
export type Instruction = {
  type: InstructionType
  fn?: any
  node?: any
}

export type ActionResult = {}

@injectable()
export class InstructionProcessor {
  constructor(
    @inject(TYPES.ActionService) private actionService: ActionService,
    @inject(TYPES.Logger) private logger: Logger
  ) {}

  async process(instruction, state, event, context): Promise<ActionResult | Boolean | void> {
    if (instruction.type === 'on-enter' || instruction.type === 'on-receive') {
      if (instruction.fn.indexOf('say ') > -1) {
        return this.invokeOutputProcessor(instruction, state, event, context)
      } else {
        return this.invokeAction(instruction, state, event, context)
      }
    } else if (instruction.type === 'transition') {
      return this.runInVM(instruction, state)
    }
    throw new Error('Could not process instruction')
  }

  private async runInVM(instruction, state) {
    return await runCode(`return ${instruction.fn}`, { state })
  }

  private async invokeOutputProcessor(instruction, state, event, context) {
    const chunks = instruction.fn.split(' ')
    const params = _.slice(chunks, 2).join(' ')

    if (chunks.length < 2) {
      throw new Error('Invalid text instruction. Expected an instruction along "say #text Something"')
    }

    const output = {
      type: chunks[1],
      value: params
    }

    // Wont work! No reply in MW?
    // DialogProcessor.default.send({ message: output, state: state, originalEvent: event, flowContext: context })
  }

  // TODO: Test for nested templating
  private async invokeAction(instruction, state, event, context): Promise<any> {
    const chunks: string[] = instruction.fn.split(' ')
    const argsStr = _.tail(chunks).join(' ')
    const actionName = _.first(chunks)!

    let args
    try {
      args = JSON.parse(argsStr)
    } catch (err) {
      throw new Error(`Action "${actionName}" has invalid arguments (not a valid JSON string): ${argsStr}`)
    }

    args = _.mapValues(args, value => {
      if (this.containsTemplate(value)) {
        const output = Mustache.render(value, state)
        if (this.containsTemplate(output)) {
          return Mustache.render(output, state)
        }
        return output
      }
      return value
    })

    const hasAction = await this.actionService.forBot(BOT_ID).hasAction(actionName)
    if (!hasAction) {
      throw new Error(`Action "${actionName}" not found, ${context}, ${state}`)
    }

    return await this.actionService.forBot(BOT_ID).runAction(actionName, state, event, args)
  }

  private containsTemplate(value: string) {
    return _.isString(value) && value.indexOf('{{') < value.indexOf('}}')
  }
}
