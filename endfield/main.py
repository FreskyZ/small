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

PRODUCT_COUNT = 12
FRIEND_COUNT = 50
MEAN = 2000
DEVIATION = 600

RANDOM_SEED = 42
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
# real quota is 320 and 50, just multiply result with 3.2 and 0.5 should be ok
BASE_QUOTA = 100
MAX_QUOTA = 300

rng = np.random.default_rng() # (seed=RANDOM_SEED)
# one day for one policy
# state[0]: balance
# state[1]: quota at beginning of the day, before increase quota
# state[2]: product_count size array for each item in warehouse
# state[3]: transaction log, an array of
#   [0]: day index, start from 1
#   [1]: description
def step(policy, state):
    day = 1 if len(state[3]) == 0 else state[3][-1][0] + 1
    state[1] += BASE_QUOTA

    # generate prices
    my_prices = np.array(rng.normal(loc=MEAN, scale=DEVIATION, size=PRODUCT_COUNT)).astype(int)
    their_prices = rng.normal(loc=MEAN, scale=DEVIATION, size=(FRIEND_COUNT, PRODUCT_COUNT)).astype(int)
    state[3].append([day, f'balance {state[0]} quota {state[1]}, warehouse {state[2]}'])
    #state[3].append([day, f'my prices {my_prices}'])

    # buy stage
    min_product_index = np.argmin(my_prices)
    min_price = my_prices[min_product_index]
    # if current quota is reaching max quota, always buy lowest product regardless of absolute price,
    if state[1] > MAX_QUOTA - BASE_QUOTA:
        amount = state[1] - (MAX_QUOTA - BASE_QUOTA)
    else:
        # policy[0]: buy base price
        base_price = policy[0]
        # amount is multiple of price difference
        amount_multiplier = policy[2]
        # if lowest price is lower than this value, buy amount base_price - lowest_price, restrict by current quota
        # also don't buy if lowest price is higher than base price
        amount = amount_multiplier * min(state[1], max(0, base_price - min_price))
    # restrict warehouse size here to avoid policies too restrict on selling, warehouse size is 2x max quota per product
    if amount > 0 and state[2][min_product_index] <= MAX_QUOTA * 2:
        state[0] -= amount * min_price
        state[1] -= amount
        state[2][min_product_index] += amount
        state[3].append([day, f'buy product#{min_product_index + 1} amount {amount} price {min_price}'])

    # sell stage
    # policy[1]: sell all products with price difference larger than this value
    threshold = policy[1]
    for product_index in range(PRODUCT_COUNT):
        amount = state[2][product_index]
        if amount == 0:
            continue
        max_price_difference = 0
        for friend_index in range(FRIEND_COUNT):
            # attention although previously investigated abs diff, there is no abs in real game
            max_price_difference = max(max_price_difference, their_prices[friend_index][product_index] - my_prices[product_index])
        if max_price_difference > threshold:
            sell_price = my_prices[product_index] + max_price_difference
            state[0] += amount * sell_price
            state[2][product_index] = 0
            state[3].append([day, f'sell product#{product_index + 1} amount {amount} sell price {sell_price}'])

def steps(policy, days):
    # start with zero balance, zero quota, empty warehouse and empty log
    state = [0, 0, [0] * PRODUCT_COUNT, []]
    for day in range(days):
        step(policy, state)
    # return profit per day per quota, transactions
    return state[0] / days / BASE_QUOTA, state[3]

def simulate(policy, days, trials):
    return np.average([steps(policy, days)[0] for _ in range(trials)])

# naive policy:
# always use all quota per day, that is buy base price is high
# always sell all products, that is difference threshold is low
# RESULT: 2325 per day per quota
# print(simulation([10000, 0], 1000, 100))

# prior art https://www.bilibili.com/video/av116007234443787/
# NEGATIVE! -200
# print(simulation([1000, 4200], 1000, 100))
# this is too restrict on selling
# profit, transactions = steps([1000, 4200], 1000)
# print(profit)
# for day, transaction in transactions:
#     print(f'day#{day} {transaction}')
# UPDATE: this should be interpreted as something like 3200 not 4200
# 3200 is like mu + 2x sigma
# 1620
print(simulate([1000, 3200, 1], 1000, 100))

# 2521
# print(simulation([1000, 2400], 1000, 100))
# mu + 1x sigma: 2541, not significant
# print(simulation([1000, 2600], 1000, 100))

# UPDATE: add buy amount multiplier
# ATTENTION amount multiplier is related with base quota multiplier, this simulation use 100, real game is 320
# 0.5/2/0.2/5: 2535, not significant
# print(simulate([1000, 2600, 5], 1000, 100))

# TODO change to namedtuple, move base quota and mean and deviation to context
# TODO add stat, average remain quota and average warehouse size, average transaction count per day
