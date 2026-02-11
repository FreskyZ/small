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
# - Task: design a trading policy that, given N, Q, Qmax, price distribution, and an optional time horizon, maximizes long-run expected profit

# import math
from random import choices
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

# TODO try fit data into mixture of multiple normal distributions, https://scikit-learn.org/stable/modules/generated/sklearn.mixture.GaussianMixture.html

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

# ==========================
# STAGE 3: policy simulation

from collections import namedtuple

# distribution: array of (mean, deviation, weight) for mixture model
Context = namedtuple('Context', 'product_count friend_count base_quota max_quota distribution')

def generate_prices(context):
    size = context.product_count * (context.friend_count + 1)
    prices = [0] * size
    for i in range(size):
        mean, deviation, _ = choices(context.distribution, weights=[d[2] for d in context.distribution])[0]
        prices[i] = np.clip([np.random.normal(loc=mean, scale=deviation)], 300, 5000)[0]
    return prices[:context.product_count], np.array(prices[context.product_count:]).reshape((context.friend_count, context.product_count))

Policy = namedtuple('Policy', 'buy_base_price sell_threshold buy_amount_multiplier', defaults=[1])
# day start from 1
# kind： buy/sell
# product: product index start from 0
Transaction = namedtuple('Transaction', 'day kind product amount price', defaults=[0, 0, 0, ''])

class State(object):
    def __init__(self, context):
        self.balance = 0
        # for each step, quota is quota at beginning of the day, before increase quota
        self.quota = 0
        # for each product, index start from 0
        self.store = [0] * context.product_count
        # Transaction[]
        self.transactions = []
        # additional log for more information
        self.logs = []
        self.total_remain_quota = 0
        self.total_storage_size = 0

def step(context, policy, day, state):
    # acquire quota
    state.quota = min(context.max_quota, state.quota + context.base_quota)
    # generate prices
    my_prices, their_prices = generate_prices(context)

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
        amount = min(state.quota, max(0, base_price - min_price) * policy.buy_amount_multiplier)
    # restrict storage size here to avoid policies too restrict on selling, choose waste quota in this case,
    # for now storage size is 2x max quota per product
    if amount > 0 and state.store[min_product_index] <= context.max_quota * 2:
        state.balance -= amount * min_price
        state.quota -= amount
        state.store[min_product_index] += amount
        state.transactions.append(Transaction(day=day, kind='buy', product=min_product_index, amount=amount, price=min_price))

    # sell stage
    # sell all products with price difference larger than this value
    threshold = policy.sell_threshold
    for product_index in range(context.product_count):
        amount = state.store[product_index]
        if amount == 0:
            continue
        max_price_difference = 0
        for friend_index in range(context.friend_count):
            # attention although previously investigated abs diff, there is no abs in real game
            max_price_difference = max(max_price_difference, their_prices[friend_index][product_index] - my_prices[product_index])
        if max_price_difference > threshold:
            sell_price = my_prices[product_index] + max_price_difference
            state.balance += amount * sell_price
            state.store[product_index] = 0
            state.transactions.append(Transaction(day=day, kind='sell', product=product_index, amount=amount, price=sell_price))
    
    state.total_remain_quota += state.quota
    state.total_storage_size += sum(state.store)

RunResult = namedtuple('RunResult', 'days logs transactions profit_per_day_per_quota avg_remain_quota avg_storage_size avg_transaction_count')

# run at least 100 days, max 3000 days (like 10 years), until...
# not good: until recent 30 days std < 10 (1 month)
# not good: until recent 100 days std < 10
# until recent 100 days sibling difference < 10
def simulate(context, policy, trials=10):
    profits = []
    for _ in range(trials):
        state = State(context)
        previous_profit = 0
        converge_counter = 0
        for day in range(1, 3000):
            step(context, policy, day, state)
            profit = int(state.balance / day / context.base_quota)
            converge_counter = converge_counter + 1 if abs(profit - previous_profit) < 10 else 0
            previous_profit = profit
            if converge_counter > 100:
                break
        print(f'{day} days, profit {previous_profit} remain quota {int(
            state.total_remain_quota / day)} storage {int(state.total_storage_size / day)} transaction {len(state.transactions) / day:.2}')
        if False:
            for transaction in state.transactions:
                print(f'day#{transaction.day} {transaction.kind} product#{transaction.product} amount {transaction.amount} price {transaction.price}')
        profits.append(previous_profit)
    print(int(sum(profits) / trials))

# context1: single normal distribution
context1 = Context(product_count=12, friend_count=50, base_quota=320, max_quota=960, distribution=[(2000, 600, 1)])

# naive policy:
# always use all quota per day, that is buy base price is high
# always sell all products, that is sell threshold is low
naive_policy = Policy(buy_base_price=10000, sell_threshold=0)
# prior art https://www.bilibili.com/video/av116007234443787/
reference_policy = Policy(buy_base_price=1000, sell_threshold=3200)
# sell threshold = mean + 1 x deviation
policy1 = Policy(buy_base_price=1000, sell_threshold=2600)
# +1.5 dev
policy15 = Policy(buy_base_price=1000, sell_threshold=2900)

# profit around 2350, quota 0, store 0, transaction 2
# simulate(context1, naive_policy)
# profit 500, quota 850, store 20000+, transaction 0.3, wastes many quota
# simulate(context1, reference_policy)
# profit 2400, quota 650, store 6000+, transaction 1.3, this takes 2000+ days to converge
# simulate(context1, policy1)
# profit 1600, quota 7500, store 15000+, this takes 2500+ days to converge, and wastes many quota 
# simulate(context1, policy15)

# context3: 3 normal distributions by guess
# RESULT: not significant,
#         nearly all effective (not too low than naive) non naive strategy is average 640 remaining quota,
#         that means they are always pushed by the max quota limit
context3 = context1._replace(distribution=[(2000, 500, 0.9), (500, 100, 0.05), (4500, 100, 0.05)])
# profit 3600, quota 0, store 0, transaction 2
# simulate(context3, naive_policy)
# profit 3700, quota 635, store 500, transaction 1.9, not significant from naive
# simulate(context3, reference_policy)
# profit 3650, quota 635, store <100, transaction 2, near naive
# simulate(context3, policy1)
# profit 3680, quota 635, store 100, transaction 2, near naive
# simulate(context3, policy15)

# RESULT: not significant by friend count
context100 = context3._replace(friend_count=100)
# simulate(context100, naive_policy) # profit 3750
# simulate(context100, reference_policy) # profit 3725, less than naive
# simulate(context100, policy1) # profit 3700, even less than naive
# simulate(context100, policy15) # profit 3720, still less than naive

# RESULT: not related to buy amount multiplier
reference_policy_m = reference_policy._replace(buy_amount_multiplier=1000)
policy1_m = policy1._replace(buy_amount_multiplier=1000)
policy15_m = policy15._replace(buy_amount_multiplier=1000)
# simulate(context3, reference_policy_m) # 3700
# simulate(context3, policy1_m) # 3660
# simulate(context3, policy15_m) # 3680

# buy base price
reference_policy_bp_2 = reference_policy._replace(buy_base_price=600)
# simulate(context3, reference_policy_bp_2) # 3690
reference_policy_bp_1 = reference_policy._replace(buy_base_price=800)
# simulate(context3, reference_policy_bp_1) # 3690
reference_policy_bp1 = reference_policy._replace(buy_base_price=1200)
# simulate(context3, reference_policy_bp1) # 3690
reference_policy_bp2 = reference_policy._replace(buy_base_price=1400)
# simulate(context3, reference_policy_bp2) # 3680
reference_policy_bp3 = reference_policy._replace(buy_base_price=1600)
# simulate(context3, reference_policy_bp3) # 3700, this makes some trials keep remain quota at <600
reference_policy_bp4 = reference_policy._replace(buy_base_price=1800)
# simulate(context3, reference_policy_bp4) # 3700, this makes some 300+, 400+ remain quota and even some like zero remain quota, but profit is still insignificant

# buy base price and decrease sell threshold
reference_policy_a = reference_policy._replace(buy_base_price=600, sell_threshold=3600)
# simulate(context3, reference_policy_a) # 3670
reference_policy_a = reference_policy._replace(buy_base_price=800, sell_threshold=3400)
# simulate(context3, reference_policy_a) # 3680
reference_policy_a = reference_policy._replace(buy_base_price=1200, sell_threshold=3000)
# simulate(context3, reference_policy_a) # 3680
reference_policy_a = reference_policy._replace(buy_base_price=1400, sell_threshold=2800)
# simulate(context3, reference_policy_a) # 3670
reference_policy_a = reference_policy._replace(buy_base_price=1600, sell_threshold=2600)
# simulate(context3, reference_policy_a) # 3660
reference_policy_a = reference_policy._replace(buy_base_price=1800, sell_threshold=2400)
# simulate(context3, reference_policy_a) # 3660, very low quota and storage, but profit is still insignificant

# RESULT: make 2 ends more heavy still don't make other policy significant
contexth = context1._replace(distribution=[(2000, 500, 0.8), (500, 100, 0.1), (4500, 100, 0.1)])
# simulate(contexth, naive_policy) # 3910
# simulate(contexth, reference_policy) # 3920, still 640 quota
# simulate(contexth, policy1) # 3895, around 620 quota
# simulate(contexth, policy15) # 3900, still 640 quota

# ??? uniform distribution: profit 4700, all quota 0, store 0, transaction 2
contextu = context1._replace(distribution=[(2000, 10000, 1)])
# simulate(contextu, naive_policy)
# simulate(contextu, reference_policy)
# simulate(contextu, policy1)
# simulate(contextu, policy15)

# the core issue seems always result in average remain quota 640
# TODO change from determine buy amount by price to determine buy threshold by remain quota
#      this should make remain quota more effective by discovering the distribution near threshold
