import JSBI from 'jsbi'
import { BLOCKED_PRICE_IMPACT_NON_EXPERT } from '../constants'
import { CurrencyAmount, Fraction, Percent, TokenAmount } from '@uniswap/sdk-core'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import { Trade as V3Trade } from '@uniswap/v3-sdk'

import { ALLOWED_PRICE_IMPACT_HIGH, ALLOWED_PRICE_IMPACT_LOW, ALLOWED_PRICE_IMPACT_MEDIUM } from '../constants'
import { Field } from '../state/swap/actions'
import { basisPointsToPercent } from './index'

const THIRTY_BIPS_FEE = new Percent(JSBI.BigInt(30), JSBI.BigInt(10000))
const ONE_HUNDRED_PERCENT = new Percent(JSBI.BigInt(10000), JSBI.BigInt(10000))
const INPUT_FRACTION_AFTER_FEE = ONE_HUNDRED_PERCENT.subtract(THIRTY_BIPS_FEE)

// computes price breakdown for the trade
export function computeTradePriceBreakdown(
  trade?: V2Trade | V3Trade | null
): { priceImpactWithoutFee: Percent | undefined; realizedLPFee: CurrencyAmount | undefined | null } {
  if (trade instanceof V2Trade) {
    // for each hop in our trade, take away the x*y=k price impact from 0.3% fees
    // e.g. for 3 tokens/2 hops: 1 - ((1 - .03) * (1-.03))
    const realizedLPFee = !trade
      ? undefined
      : ONE_HUNDRED_PERCENT.subtract(
          trade.route.pairs.reduce<Fraction>(
            (currentFee: Fraction): Fraction => currentFee.multiply(INPUT_FRACTION_AFTER_FEE),
            ONE_HUNDRED_PERCENT
          )
        )

    // remove lp fees from price impact
    const priceImpactWithoutFeeFraction = trade && realizedLPFee ? trade.priceImpact.subtract(realizedLPFee) : undefined

    // the x*y=k impact
    const priceImpactWithoutFeePercent = priceImpactWithoutFeeFraction
      ? new Percent(priceImpactWithoutFeeFraction?.numerator, priceImpactWithoutFeeFraction?.denominator)
      : undefined

    // the amount of the input that accrues to LPs
    const realizedLPFeeAmount =
      realizedLPFee &&
      trade &&
      (trade.inputAmount instanceof TokenAmount
        ? new TokenAmount(trade.inputAmount.token, realizedLPFee.multiply(trade.inputAmount.raw).quotient)
        : CurrencyAmount.ether(realizedLPFee.multiply(trade.inputAmount.raw).quotient))

    return { priceImpactWithoutFee: priceImpactWithoutFeePercent, realizedLPFee: realizedLPFeeAmount }
  } else if (trade instanceof V3Trade) {
    const realizedLPFee = !trade
      ? undefined
      : ONE_HUNDRED_PERCENT.subtract(
          trade.route.pools.reduce<Fraction>(
            (currentFee: Fraction, pool): Fraction =>
              currentFee.multiply(ONE_HUNDRED_PERCENT.subtract(new Fraction(pool.fee, 10_000))),
            ONE_HUNDRED_PERCENT
          )
        )
    const realizedLPFeeAmount =
      realizedLPFee &&
      trade &&
      (trade.inputAmount instanceof TokenAmount
        ? new TokenAmount(trade.inputAmount.token, realizedLPFee.multiply(trade.inputAmount.raw).quotient)
        : CurrencyAmount.ether(realizedLPFee.multiply(trade.inputAmount.raw).quotient))

    return {
      // TODO: real price impact
      priceImpactWithoutFee: new Percent(0),
      realizedLPFee: realizedLPFeeAmount,
    }
  } else {
    return {
      priceImpactWithoutFee: undefined,
      realizedLPFee: undefined,
    }
  }
}

// computes the minimum amount out and maximum amount in for a trade given a user specified allowed slippage in bips
export function computeSlippageAdjustedAmounts(
  trade: V2Trade | V3Trade | undefined,
  allowedSlippage: number
): { [field in Field]?: CurrencyAmount } {
  const pct = basisPointsToPercent(allowedSlippage)
  return {
    [Field.INPUT]: trade?.maximumAmountIn(pct),
    [Field.OUTPUT]: trade?.minimumAmountOut(pct),
  }
}

const IMPACT_TIERS = [
  BLOCKED_PRICE_IMPACT_NON_EXPERT,
  ALLOWED_PRICE_IMPACT_HIGH,
  ALLOWED_PRICE_IMPACT_MEDIUM,
  ALLOWED_PRICE_IMPACT_LOW,
]

export function warningSeverity(priceImpact: Percent | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!priceImpact) return 4
  let impact = IMPACT_TIERS.length
  for (const impactLevel of IMPACT_TIERS) {
    if (impactLevel.lessThan(priceImpact)) return impact as 0 | 1 | 2 | 3 | 4
    impact--
  }
  return 0
}

export function formatExecutionPrice(trade: V2Trade | V3Trade | undefined, inverted: boolean | undefined): string {
  if (!trade) {
    return ''
  }
  return inverted
    ? `${trade.executionPrice.invert().toSignificant(6)} ${trade.inputAmount.currency.symbol} / ${
        trade.outputAmount.currency.symbol
      }`
    : `${trade.executionPrice.toSignificant(6)} ${trade.outputAmount.currency.symbol} / ${
        trade.inputAmount.currency.symbol
      }`
}
