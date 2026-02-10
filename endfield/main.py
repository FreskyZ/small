# 明日方舟：终末地 地区建设 弹性需求物资 strategy

# docker run -it -v.:/endfield --name endfield1 mydevc/python:2
# cd /endfield
# UV_CACHE_DIR=/endfield/.cache uv init
# chown 1000:1000 main.py pyproject.toml uv.lock .python-version
# uv add numpy pandas matplotlib
# uv run main.py

# Problem statement
# - There are N distinct products produced at location A and demanded at location A and B.
# - Each day, every product has a price at A and a price at B. Prices are random, independent across days and products.
# - You may buy any quantity of products at A as long as you have quota. Buying consumes quota proportional to quantity.
# - Each day you receive Q units of quota; unused quota carries over but cannot exceed Qmax.
# - Bought products can be stored indefinitely in an infinite-capacity warehouse and sold later at A or B's daily price.
# - Selling is unrestricted by quota; only purchases consume quota.
# - Naive policy: every day spend all available quota to buy the product with the largest immediate price difference and sell immediately.
# - However, better long-term profit may arise by saving quota for future opportunities or by holding inventory until future prices are higher.
# - Task: design a trading policy that, given N, Q, Qmax, price distributions, and an optional time horizon, maximizes long-run expected profit

# import math
# import pandas as pd
import numpy as np
# import matplotlib.pyplot as plt

# ===========================
# STAGE 1: price distribution

# if they use different parameter for each product or for each use in normal distribution,
# then I need to log prices per product for a long time, which is too much work for me,
# so assume all price use normal distribution with same parameter (mu and sigma),
# then you can gather all prices in one day and fit them into one normal distribution
# but still try keep more information in data, they are stored by date, user and product name
# RESULT: regard as 2000,600 normal distribution

# def normal_cdf(x, mu, sigma):
#     return 0.5 * (1 + math.erf((x - mu) / (sigma * math.sqrt(2))))

# df = pd.read_csv('data/price1.csv')
# prices = df['price'].dropna().to_numpy()
# if prices.size == 0:
#     print('no price data')
# else:
#     n = prices.size
#     mu_hat = float(prices.mean())
#     sigma_hat = float(prices.std(ddof=1))
#     print(f'fitted mu={mu_hat:.6f}, sigma={sigma_hat:.6f}')

#     #mu_hat, sigma_hat = 2000, 600
#     if sigma_hat <= 0 or n < 2:
#         print('not enough variation to test normality')
#     else:
#         # empirical KS statistic against fitted normal
#         xs = np.sort(prices)
#         cdf_model = np.array([normal_cdf(x, mu_hat, sigma_hat) for x in xs])
#         ecdf_upper = np.arange(1, n + 1) / n
#         ecdf_lower = np.arange(0, n) / n
#         D_plus = np.max(ecdf_upper - cdf_model)
#         D_minus = np.max(cdf_model - ecdf_lower)
#         D_obs = max(D_plus, D_minus)

#         # parametric bootstrap to get p-value (accounts for parameter estimation)
#         rng = np.random.default_rng()
#         iters = 2000
#         cnt = 0
#         for _ in range(iters):
#             sample = rng.normal(mu_hat, sigma_hat, n)
#             xs_s = np.sort(sample)
#             mu_s = float(sample.mean())
#             sigma_s = float(sample.std(ddof=1))
#             if sigma_s <= 0:
#                 continue
#             cdf_model_s = np.array([normal_cdf(x, mu_s, sigma_s) for x in xs_s])
#             ecdf_up_s = np.arange(1, n + 1) / n
#             ecdf_low_s = np.arange(0, n) / n
#             Dp = np.max(ecdf_up_s - cdf_model_s)
#             Dm = np.max(cdf_model_s - ecdf_low_s)
#             D_sim = max(Dp, Dm)
#             if D_sim >= D_obs:
#                 cnt += 1

#         p_value = (cnt + 1) / (iters + 1)
#         print(f'KS-like D={D_obs:.6f}, p-value={p_value:.6f}')

# try:
#     bin_width = 80
#     min_p = float(np.min(prices))
#     max_p = float(np.max(prices))
#     # create bins that cover the range [min_p, max_p]
#     bins = np.arange(math.floor(min_p / bin_width) * bin_width,
#                         math.ceil(max_p / bin_width) * bin_width + bin_width,
#                         bin_width)
#     plt.figure(figsize=(8, 4))
#     plt.hist(prices, bins=bins, edgecolor='black')
#     plt.xlabel('price')
#     plt.ylabel('prob')
#     plt.title('price distribution')
#     plt.tight_layout()
#     plt.savefig('price_histogram.png', dpi=150)
#     plt.close()
# except Exception as e:
#     print(f'failed to save histogram: {e}')

# =====================================
# STAGE 2 price difference distribution

# AI says price difference distribution between
# 2 sets of random variables is very difficult to get analysis result
# so monte carlo
# RESULT: count 12 => mean 1662, median 1621, 95pct 2424
#         count 4  => mean 1243, median 1194, 95pct 2114
# UPDATE: friend count significantly increase price difference
#         friend 50  => mean 3065, 95pct 3697
#         friend 100 => mean 3153, 95pct 3805

# PRODUCT_COUNT = 12
# FRIEND_COUNT = 50
# MEAN = 2000
# DEVIATION = 600
# RANDOM_SEED = 42

# trials = 100000
# rng = np.random.default_rng(RANDOM_SEED)
# # draw shape (trials, product_count) for A and B
# a = rng.normal(loc=MEAN, scale=DEVIATION, size=(trials, PRODUCT_COUNT))
# b = rng.normal(loc=MEAN, scale=DEVIATION, size=(trials, PRODUCT_COUNT * FRIEND_COUNT))
# # compute per-trial extrema to get the max absolute pairwise difference
# a_min, a_max = np.min(a, axis=1), np.max(a, axis=1)
# b_min, b_max = np.min(b, axis=1), np.max(b, axis=1)
# maxima = np.maximum(a_max - b_min, b_max - a_min)
# mean_v = float(np.mean(maxima))
# median_v = float(np.median(maxima))
# q95 = float(np.percentile(maxima, 95))
# print(f'trials={trials}, products={PRODUCT_COUNT}, mean={mean_v:.3f}, median={median_v:.3f}, 95pct={q95:.3f}')
# plt.figure(figsize=(8, 4))
# bins = min(200, max(20, int(len(maxima) ** 0.5)))
# plt.hist(maxima, bins=bins, density=True, alpha=0.8, edgecolor='black')
# plt.xlabel('max |price_A - price_B|')
# plt.ylabel('density')
# plt.title('Monte Carlo: distribution of max absolute price difference')
# plt.tight_layout()
# try:
#     plt.savefig('max_price_diff_hist.png', dpi=150)
#     plt.close()
# except Exception as e:
#     print(f'failed to save plot: {e}')

# ==========================
# STAGE 3: policy simulation

from collections import namedtuple

Context = namedtuple('Context', 'product_count friend_count base_quota max_quota mean deviation')

# see usage
Policy = namedtuple('Policy', 'buy_base_price buy_amount_multiplier sell_threshold')

# day start from 1
# kind： state/buy/sell
# product: product index start from 0
# description for state
Transaction = namedtuple('Transaction', 'day kind product amount price description', defaults=[0, 0, 0, ''])
# record total to calculate average
Statistics = namedtuple('Statistics', 'total_remain_quota total_warehouse_size total_transaction_count', defaults=[0, 0, 0])

class State(object):
    def __init__(self, context):
        self.balance = 0
        # for each step, quota is quota at beginning of the day, before increase quota
        self.quota = 0
        # for each product, index start from 0
        self.warehouse = [0] * context.product_count
        self.transactions = []
        self.total_remain_quota = 0
        self.total_warehouse_size = 0
        self.total_transaction_count = 0
        self.transactions = []

def generate_prices(context):
    # standard normal guess
    # my_prices = np.array(rng.normal(loc=context.mean, scale=context.deviation, size=context.product_count)).astype(int)
    # their_prices = rng.normal(loc=context.mean, scale=context.deviation, size=(context.friend_count, context.product_count)).astype(int)
    
    # multiple normal guess
    total_samples = context.product_count * (context.friend_count + 1)
    tail_samples = int(total_samples * 0.05)
    main_samples = total_samples - 2 * tail_samples

    main_prices = np.array(rng.normal(loc=context.mean, scale=context.deviation, size=main_samples)).astype(int)
    low_prices = np.array(rng.normal(loc=500, scale=100, size=tail_samples)).astype(int)
    high_prices = np.array(rng.normal(loc=4500, scale=100, size=tail_samples)).astype(int)
    all_prices = np.concatenate([main_prices, low_prices, high_prices])
    rng.shuffle(all_prices)
    my_prices, their_prices = all_prices[:context.product_count], all_prices[context.product_count:].reshape((context.friend_count, context.product_count))

    return my_prices, their_prices

rng = np.random.default_rng()
def step(context, policy, state):
    day = 1 if len(state.transactions) == 0 else state.transactions[-1].day + 1
    state.quota = min(context.max_quota, state.quota + context.base_quota)
    state.transactions.append(Transaction(day=day, kind='state', description=f'balance {state.balance} quota {state.quota}, warehouse {state.warehouse}'))

    # generate prices
    my_prices, their_prices = generate_prices(context)
    # state.transactions.append(Transaction(day=day, kind='state', description=f'my prices {my_prices}'))

    transaction_count = 0
    # buy stage
    min_product_index = np.argmin(my_prices)
    min_price = my_prices[min_product_index]
    # if current quota is reaching max quota, always buy lowest product regardless of absolute price,
    if state.quota > context.max_quota - context.base_quota:
        amount = state.quota - (context.max_quota - context.base_quota)
    else:
        base_price = policy.buy_base_price
        # amount is multiple of price difference
        # if lowest price is lower than this value, buy amount base_price - lowest_price, restrict by current quota
        # also don't buy if lowest price is higher than base price
        amount = min(state.quota, max(0, base_price - min_price)) * policy.buy_amount_multiplier
    # restrict warehouse size here to avoid policies too restrict on selling, choose waste quota in this case,
    # for now warehouse size is 2x max quota per product
    if amount > 0 and state.warehouse[min_product_index] <= context.max_quota * 2:
        transaction_count += 1
        state.balance -= amount * min_price
        state.quota -= amount
        state.warehouse[min_product_index] += amount
        state.transactions.append(Transaction(day=day, kind='buy', product=min_product_index, amount=amount, price=min_price))

    # sell stage
    # sell all products with price difference larger than this value
    threshold = policy.sell_threshold
    for product_index in range(context.product_count):
        amount = state.warehouse[product_index]
        if amount == 0:
            continue
        max_price_difference = 0
        for friend_index in range(context.friend_count):
            # attention although previously investigated abs diff, there is no abs in real game
            max_price_difference = max(max_price_difference, their_prices[friend_index][product_index] - my_prices[product_index])
        if max_price_difference > threshold:
            transaction_count += 1
            sell_price = my_prices[product_index] + max_price_difference
            state.balance += amount * sell_price
            state.warehouse[product_index] = 0
            state.transactions.append(Transaction(day=day, kind='sell', product=product_index, amount=amount, price=sell_price))
    
    state.total_remain_quota += state.quota
    state.total_warehouse_size += sum(state.warehouse)
    state.total_transaction_count += transaction_count

Report = namedtuple('Report', 'days profit_per_day_per_quota avg_remain_quota avg_warehouse_size avg_transaction_count transactions')

# return report, transactions
def simulate(context, policy, days):
    state = State(context)
    for day in range(days):
        step(context, policy, state)
    return Report(
        days=days,
        profit_per_day_per_quota=int(state.balance / days / context.base_quota),
        avg_remain_quota=state.total_remain_quota / days,
        avg_warehouse_size=state.total_warehouse_size / days,
        avg_transaction_count=state.total_transaction_count / days,
        transactions=state.transactions)

def print_report(report, include_transactions=False):
    print(f'{report.days} days, profit {report.profit_per_day_per_quota} remain quota {report.avg_remain_quota} warehouse {report.avg_warehouse_size} transaction count {report.avg_transaction_count}')
    if include_transactions:
        for transaction in report.transactions:
            if transaction.kind == 'state':
                print(f'day#{transaction.day} {transaction.description}')
            else:
                print(f'day#{transaction.day} {transaction.kind} product#{transaction.product} amount {transaction.amount} price {transaction.price}')

def expect_profit(context, policy, days, trials):
    return int(np.average([simulate(context, policy, days).profit_per_day_per_quota for _ in range(trials)]))

context = Context(product_count=12, friend_count=50, base_quota=320, max_quota=960, mean=2000, deviation=600)

# naive policy:
# always use all quota per day, that is buy base price is high
# always sell all products, that is difference threshold is low
# naive_policy = Policy(buy_base_price=10000, buy_amount_multiplier=1, sell_threshold=0)
# # RESULT: profit 2325, remain quota 0, remain warehouse 0, transaction count 2
# # UPDATE: try new price distribution: profit 2700
# print_report(simulate(context, naive_policy, 1000))
# print(expect_profit(context, naive_policy, 1000, 100))

# prior art https://www.bilibili.com/video/av116007234443787/
# av116007234443787_policy = Policy(buy_base_price=1000, buy_amount_multiplier=1, sell_threshold=3200)
# # RESULT: profit 538, remain quota 865?, remain warehouse 22000, transaction count 0.3
# # this is literally full warehouse
# print_report(simulate(context, av116007234443787_policy, 1000))
# print(expect_profit(context, av116007234443787_policy, 1000, 100))

# sell threshold = mean + 1 x deviation
# policy = Policy(buy_base_price=1000, buy_amount_multiplier=1, sell_threshold=2600)
# # RESULT: profit 2392, remain quota 654, remain warehouse 6000-7000, transaction count 1.28
# # remain quota means this policy nearly always keep at max_quota - base_quota
# # UPDATE: try new price distribution: profit 2800, quota 635, remaining warehouse 1200, transaction count 1.75
# print_report(simulate(context, policy, 1000))
# # print_report(simulate(context, policy, 365), include_transactions=True)
# print(expect_profit(context, policy, 1000, 100))

# also +1.5 dev and +2 dev
# policy = Policy(buy_base_price=1000, buy_amount_multiplier=1, sell_threshold=2900)
# # RESULT: profit 2885, remain quota ~640, remain warehouse ~4200, transaction count 1.44
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print(expect_profit(context, policy, 1000, 100))
# policy = Policy(buy_base_price=1000, buy_amount_multiplier=1, sell_threshold=3200)
# # RESULT: profit 2085, remain quota 720, remain warehouse 14000, transaction count 0.85
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print_report(simulate(context, policy, 1000))
# print(expect_profit(context, policy, 1000, 100))

# TODO price distribution significantly affects profit, add price distribution to context
# TODO try fit data into mixture of multiple normal distributions, https://scikit-learn.org/stable/modules/generated/sklearn.mixture.GaussianMixture.html
